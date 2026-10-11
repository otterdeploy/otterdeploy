import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import { environmentIdOrReject } from "../../lib/environment/resolve-slug-reject";
import { diffManifest, resolveEnvironment } from "../../stack/manifest";
import { renderProjectFromRows, toComposeYaml } from "../../stack/render";
import { getProject } from "./handlers";
import {
  discardManifest,
  loadAppliedSnapshot,
  loadManifest,
  resolvedManifest,
  saveManifest,
} from "./manifest";
import { applyManifest } from "./manifest-apply";
import { refuseUnrunnablePlacement } from "./manifest-apply-placement";
import { loadRefTable, makeEnvRefResolver, withStagedServices } from "./manifest-apply-refs";
import { enrichComposeCreates } from "./manifest-compose-enrich";
import { manifestRemovals } from "./manifest-removals";
import { renameResource } from "./manifest-rename-apply";
import { loadCurrentState } from "./manifest-state";
import { deleteDraftCredentialsNotIn } from "./queries";
import { resolveProjectEnvironmentScope } from "./queries/resource";

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
      const scope = { projectId: input.projectId, organizationId: context.activeOrganizationId };

      // What this payload DELETES by omission, computed before anything is
      // written so a dry run and a real save report the same thing.
      const stored = await loadManifest(scope);
      if (stored.isErr()) {
        throw matchError(stored.error, { ProjectNotFoundError: () => errors.NOT_FOUND() });
      }
      const removed = manifestRemovals(stored.value.manifest, input.manifest);

      // Refused at stage time, so the form that staged it can say why and stay
      // open, rather than staging a change apply can only ever skip.
      const placement = await refuseUnrunnablePlacement({
        previous: stored.value.manifest,
        next: input.manifest,
        organizationId: context.activeOrganizationId,
      });
      if (placement.isErr()) {
        throw errors.PLACEMENT_UNSUPPORTED({ message: placement.error.message });
      }

      if (input.dryRun) {
        // The stored version is returned so the caller can use it as its
        // `expectedVersion` on the real save that follows.
        return { version: stored.value.version, removed, dryRun: true };
      }

      const outcome = await saveManifest(scope, {
        manifest: input.manifest,
        expectedVersion: input.expectedVersion,
      });
      if (outcome.isErr()) {
        throw matchError(outcome.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ManifestVersionConflictError: () => errors.CONFLICT(),
          ManifestProjectMismatchError: (error) =>
            errors.PROJECT_MISMATCH({ message: error.message }),
        });
      }
      return { ...outcome.value, removed, dryRun: false };
    },
  ),

  diff: orgScopedProcedure.project.manifest.diff.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.projectId } });
    // The project must be the caller's before anything of it is read. An
    // inline manifest skips `resolvedManifest` (the only org-scoped read
    // below), and the diff it computes carries the project's current state.
    const ref = { projectId: input.projectId, organizationId: context.activeOrganizationId };
    const owned = await getProject({ id: ref.projectId, organizationId: ref.organizationId });
    if (owned.isErr()) {
      throw matchError(owned.error, { ProjectNotFoundError: () => errors.NOT_FOUND() });
    }
    // A caller-supplied manifest is previewed WITHOUT being saved: a diff is a
    // read, and making it a write is what let `--dry-run` overwrite the
    // baseline it claimed not to touch. Falls back to the saved manifest.
    const resolved = input.manifest
      ? resolveEnvironment(input.manifest, input.environment)
      : await resolvedManifest(ref, input.environment);
    if (resolved.isErr()) {
      throw matchError(resolved.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
        ManifestMergeError: (error) => errors.INVALID_MANIFEST({ message: error.message }),
      });
    }
    if (!resolved.value) return { resolved: null, changes: [] };
    // Same slug→id conversion the apply endpoint uses, so the plan the operator
    // previews is scoped identically to the one that executes.
    const environmentId = await environmentIdOrReject(input.projectId, input.environment, errors);
    const scope = await resolveProjectEnvironmentScope(input.projectId, environmentId);
    // No environment pointer means nothing to diff against. An empty preview
    // beats a plan that claims every resource is new.
    if (!scope) return { resolved: resolved.value, changes: [] };
    const [current, refTable, applied] = await Promise.all([
      loadCurrentState(input.projectId, scope),
      loadRefTable(input.projectId, scope),
      // What the manifest has actually applied. Without it every live resource
      // missing from the manifest reads as a pending DELETE, including ones the
      // manifest never owned.
      loadAppliedSnapshot(ref),
    ]);
    // Resolve ${database:…}/${service:…} refs before comparing. Apply stores
    // the RESOLVED value in the env rows, so a raw-text compare surfaced a
    // permanent phantom "update" for every ref-valued declaration.
    // Same staged-service view apply resolves with, so a ref to a service this
    // manifest creates previews as the value it will get.
    const stagedServices = Object.keys(resolved.value.services).filter((n) => !current.services[n]);
    const changes = enrichComposeCreates(
      diffManifest(resolved.value, current, {
        resolveEnvValue: makeEnvRefResolver(withStagedServices(refTable, stagedServices)),
        applied,
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
          ManifestMergeError: (error) => errors.INVALID_MANIFEST({ message: error.message }),
        });
      }
      // Nothing saved (or a stored manifest that no longer parses, which
      // loadManifest reports and reads as absent). Answering success with
      // appliedCount 0 here was indistinguishable from "up to date".
      if (!resolved.value) throw errors.NO_MANIFEST();
      return applyManifest({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
        manifest: resolved.value,
        environmentId: await environmentIdOrReject(input.projectId, input.environment, errors),
        only: input.only,
        actorUserId: context.session?.user.id ?? null,
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
      // Drop draft credentials for any staged database the discard removed.
      // Keep only the ones the reverted manifest still declares.
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
  // Deploy, no daylight between the two code routes. The discrete
  // save/diff/apply endpoints stay for the stack-code editor's
  // "preview before deploy" flow where the user wants to inspect
  // the diff between save and apply.
  applyChange: requirePermission({ project: ["update"] }).project.manifest.applyChange.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });

      const stored = await loadManifest({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (stored.isErr()) {
        throw matchError(stored.error, { ProjectNotFoundError: () => errors.NOT_FOUND() });
      }
      const placement = await refuseUnrunnablePlacement({
        previous: stored.value.manifest,
        next: input.manifest,
        organizationId: context.activeOrganizationId,
      });
      if (placement.isErr()) {
        throw errors.PLACEMENT_UNSUPPORTED({ message: placement.error.message });
      }

      // Resolve before saving: an override that does not merge is refused
      // without staging a manifest this call could never apply.
      const resolved = resolveEnvironment(input.manifest, input.environment);
      if (resolved.isErr()) {
        throw errors.INVALID_MANIFEST({ message: resolved.error.message });
      }

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
          ManifestProjectMismatchError: (error) =>
            errors.PROJECT_MISMATCH({ message: error.message }),
        });
      }

      // Apply exactly what was just saved. Re-reading it raced a concurrent
      // discard (which could leave nothing to apply) and gained nothing.
      const applied = await applyManifest({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
        manifest: resolved.value,
        // Must match the environment the manifest was just resolved for. A
        // manifest resolved for staging applied against production's rows
        // would diff staging's desired state onto production's resources.
        environmentId: await environmentIdOrReject(input.projectId, input.environment, errors),
        sourceUploads: input.sourceUploads,
        actorUserId: context.session?.user.id ?? null,
        log: context.log,
      });
      return { version: saved.value.version, ...applied };
    },
  ),
};
