import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import { environmentIdForSlug } from "../../lib/environment/resolve-slug";
import { parseCompose, summarizeCompose } from "../../stack/compose";
import { diffManifest, type Change, type Manifest } from "../../stack/manifest";
import { renderProjectFromRows, toComposeYaml } from "../../stack/render";
import { getProject } from "./handlers";
import { discardManifest, loadManifest, resolvedManifest, saveManifest } from "./manifest";
import { applyManifest } from "./manifest-apply";
import { loadRefTable, makeEnvRefResolver } from "./manifest-apply-refs";
import { renameResource } from "./manifest-rename";
import { loadCurrentState } from "./manifest-state";
import { deleteDraftCredentialsNotIn } from "./queries";
import { resolveProjectEnvironmentScope } from "./queries/resource";

/**
 * Attach a parsed service summary to each compose `create` change so the graph
 * can render the staged stack as a ghost group node WITH its service cards —
 * not an empty "No services parsed yet" box. Parsing lives here (the handler),
 * not in the pure `diffManifest`, so the diff stays YAML-free and testable.
 * Git stacks have no inline file to parse; their cards appear after the build.
 */
function enrichComposeCreates(changes: Change[], manifest: Manifest): Change[] {
  return changes.map((c) => {
    if (c.resource !== "compose" || c.kind !== "create") return c;
    const spec = manifest.composes[c.name];
    if (!spec || spec.source !== "inline") return c;
    const parsed = parseCompose(spec.content);
    if (parsed.isErr()) return c;
    return {
      ...c,
      details: {
        ...c.details,
        services: summarizeCompose(parsed.value),
        // Carry the template brand so the pending ghost group renders the
        // stack's logo immediately, before the first deploy persists it.
        ...(spec.logoBrand ? { logoBrand: spec.logoBrand } : {}),
      },
    };
  });
}

export const manifestRouter = {
  get: orgScopedProcedure.project.manifest.get.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.id } });
    const row = await loadManifest({
      projectId: input.id,
      organizationId: context.activeOrganizationId,
    });
    if (row.isErr()) {
      throw matchError(row.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return row.value;
  }),

  save: requirePermission({ project: ["update"] }).project.manifest.save.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const outcome = await saveManifest(
        {
          projectId: input.projectId,
          organizationId: context.activeOrganizationId,
        },
        { manifest: input.manifest, expectedVersion: input.expectedVersion },
      );
      if (outcome.isErr()) {
        throw matchError(outcome.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ManifestVersionConflictError: () => errors.CONFLICT(),
        });
      }
      return outcome.value;
    },
  ),

  diff: orgScopedProcedure.project.manifest.diff.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.projectId } });
    const resolved = await resolvedManifest(
      {
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      },
      input.environment,
    );
    if (resolved.isErr()) {
      throw matchError(resolved.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    if (!resolved.value) return { resolved: null, changes: [] };
    // Same slug→id conversion the apply endpoint uses, so the plan the operator
    // previews is scoped identically to the one that executes.
    const environmentId = await environmentIdForSlug(input.projectId, input.environment);
    const scope = await resolveProjectEnvironmentScope(input.projectId, environmentId);
    // No environment pointer means nothing to diff against — an empty preview
    // beats a plan that claims every resource is new.
    if (!scope) return { resolved: resolved.value, changes: [] };
    const [current, refTable] = await Promise.all([
      loadCurrentState(input.projectId, scope),
      loadRefTable(input.projectId),
    ]);
    // Resolve ${database:…}/${service:…} refs before comparing — apply stores
    // the RESOLVED value in the env rows, so a raw-text compare surfaced a
    // permanent phantom "update" for every ref-valued declaration.
    const changes = enrichComposeCreates(
      diffManifest(resolved.value, current, {
        resolveEnvValue: makeEnvRefResolver(refTable),
      }),
      resolved.value,
    );
    return { resolved: resolved.value, changes };
  }),

  export: orgScopedProcedure.project.manifest.export.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.projectId } });
    // Authorize by loading the project for the org first; the
    // renderer reads by projectId without a tenant check itself.
    const projectRow = await getProject({
      id: input.projectId,
      organizationId: context.activeOrganizationId,
    });
    if (projectRow.isErr()) {
      throw matchError(projectRow.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    const file = await renderProjectFromRows(input.projectId);
    return { yaml: toComposeYaml(file) };
  }),

  apply: requirePermission({ project: ["update"] }).project.manifest.apply.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const resolved = await resolvedManifest(
        {
          projectId: input.projectId,
          organizationId: context.activeOrganizationId,
        },
        input.environment,
      );
      if (resolved.isErr()) {
        throw matchError(resolved.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      if (!resolved.value) {
        return {
          appliedCount: 0,
          skipped: [],
          lastAppliedAt: new Date().toISOString(),
        };
      }
      return applyManifest({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
        manifest: resolved.value,
        environmentId: await environmentIdForSlug(input.projectId, input.environment),
        log: context.log,
      });
    },
  ),

  discard: requirePermission({ project: ["update"] }).project.manifest.discard.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await discardManifest(
        {
          projectId: input.projectId,
          organizationId: context.activeOrganizationId,
        },
        input.only,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      // Drop draft credentials for any staged database the discard removed —
      // keep only the ones the reverted manifest still declares.
      const reverted = await loadManifest({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (reverted.isOk()) {
        await deleteDraftCredentialsNotIn(
          input.projectId,
          Object.keys(reverted.value.manifest?.databases ?? {}),
        );
      }
      return result.value;
    },
  ),

  rename: requirePermission({ project: ["update"] }).project.manifest.rename.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await renameResource(
        { projectId: input.projectId, organizationId: context.activeOrganizationId },
        { kind: input.resource, from: input.from, to: input.to },
      );
      if (result.ok) return { version: result.version };
      if (result.code === "not-found") throw errors.NOT_FOUND();
      throw errors.BAD_REQUEST({ message: result.message });
    },
  ),

  // One-shot save+apply. The common path for both CLI sync and UI
  // Deploy — no daylight between the two code routes. The discrete
  // save/diff/apply endpoints stay for the stack-code editor's
  // "preview before deploy" flow where the user wants to inspect
  // the diff between save and apply.
  applyChange: requirePermission({ project: ["update"] }).project.manifest.applyChange.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });

      const saved = await saveManifest(
        {
          projectId: input.projectId,
          organizationId: context.activeOrganizationId,
        },
        { manifest: input.manifest, expectedVersion: input.expectedVersion },
      );
      if (saved.isErr()) {
        throw matchError(saved.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ManifestVersionConflictError: () => errors.CONFLICT(),
        });
      }

      const resolved = await resolvedManifest(
        {
          projectId: input.projectId,
          organizationId: context.activeOrganizationId,
        },
        input.environment,
      );
      if (resolved.isErr()) {
        throw matchError(resolved.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      if (!resolved.value) {
        return {
          version: saved.value.version,
          appliedCount: 0,
          skipped: [],
          lastAppliedAt: new Date().toISOString(),
        };
      }
      const applied = await applyManifest({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
        manifest: resolved.value,
        // Must match the environment the manifest was just resolved for. A
        // manifest resolved for staging applied against production's rows
        // would diff staging's desired state onto production's resources.
        environmentId: await environmentIdForSlug(input.projectId, input.environment),
        log: context.log,
      });
      return { version: saved.value.version, ...applied };
    },
  ),
};
