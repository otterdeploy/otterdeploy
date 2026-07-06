/**
 * oRPC handlers for `type: compose` resources. Thin wrappers over the compose
 * service layer (parse / queries / deploy). See docs/designs/compose.md.
 */
import { projectScopedProcedure, requirePermission } from "../..";
import { removeResourceDir } from "../../lib/data-dir";
import { parseCompose, summarizeCompose } from "../../stack/compose";
import { removeComposeStack } from "../../swarm";
import { getProjectInOrg } from "../project/queries";
import { enqueueComposeBuild } from "./build-trigger";
import { cleanupOrphanedComposeVars } from "./cleanup-vars";
import { createComposeResource } from "./create";
import { deployCompose, reconcileComposeDomains, removeComposeDomains } from "./deploy";
import { collectVarRefs, interpolate } from "./env";
import {
  type ComposeRecord,
  deleteComposeRecord,
  getComposeRecord,
  listComposeRecords,
  updateComposeExposed,
} from "./queries";
import { removeStackServices } from "./reconcile";

function toView(rec: ComposeRecord) {
  return {
    resourceId: rec.resource.id,
    name: rec.resource.name,
    source: rec.compose.source,
    composeContent: rec.compose.composeContent,
    stackName: rec.compose.stackName,
    services: rec.compose.services,
    exposed: rec.compose.exposed,
  };
}

export const composeRouter = {
  // Stateless preview for the wizard — validate + summarize a pasted file.
  parse: projectScopedProcedure.compose.parse.handler(async ({ input }) => {
    const parsed = parseCompose(input.content);
    if (parsed.isErr()) {
      return {
        valid: false,
        error: parsed.error.message,
        errorLine: parsed.error.line ?? null,
        errorColumn: parsed.error.column ?? null,
        name: null,
        vars: [],
        services: [],
        warnings: [],
      };
    }
    return {
      valid: true,
      error: null,
      errorLine: null,
      errorColumn: null,
      // Compose `name:`, else the first service — a sensible stack-name default.
      name: parsed.value.name ?? parsed.value.services[0]?.name ?? null,
      // `${VAR}` refs the file uses — the wizard prompts the user to fill these.
      vars: collectVarRefs(parsed.value),
      // Resolve `${VAR:-default}` in the image so the preview shows the real
      // ref (project vars aren't loaded here, so only defaults apply).
      services: summarizeCompose(parsed.value).map((s) => ({
        ...s,
        image: s.image ? interpolate(s.image, {}) : null,
      })),
      warnings: parsed.value.warnings,
    };
  }),

  list: projectScopedProcedure.compose.list.handler(async ({ input }) => {
    const rows = await listComposeRecords(input.projectId);
    return rows.map(toView);
  }),

  get: projectScopedProcedure.compose.get.handler(async ({ input, errors }) => {
    const rec = await getComposeRecord(input.projectId, input.resourceId);
    if (!rec) throw errors.NOT_FOUND();
    return toView(rec);
  }),

  // A compose stack is a group of services, so it rides the `service`
  // permissions (members create/redeploy, only admins/owners delete).
  create: requirePermission({ service: ["create"] }).compose.create.handler(
    async ({ input, context, errors }) => {
      const result = await createComposeResource({
        input,
        organizationId: context.activeOrganizationId,
        log: context.log,
      });
      if (result.isErr()) {
        const failure = result.error;
        if (failure.reason === "not_found") throw errors.NOT_FOUND();
        if (failure.reason === "conflict") throw errors.CONFLICT();
        throw errors.INVALID_INPUT({ message: failure.message });
      }
      return result.value;
    },
  ),

  redeploy: requirePermission({ service: ["deploy"] }).compose.redeploy.handler(
    async ({ input, context, errors }) => {
      const rec = await getComposeRecord(input.projectId, input.resourceId);
      if (!rec) throw errors.NOT_FOUND();

      // Git-sourced stacks always redeploy through the build worker: it
      // re-clones at the branch head, rebuilds any `build:` services, and
      // refetches the compose file before deploying. A direct `deployCompose`
      // would redeploy stale persisted content — or, for a stack whose first
      // build never finished, throw on absent content.
      if (rec.compose.source === "git") {
        if (!rec.compose.gitRepoUrl || !rec.compose.gitRef) {
          return {
            ok: false,
            error: "Git stack is missing its repo URL or ref",
            status: "failed",
          };
        }
        const enq = await enqueueComposeBuild({
          projectId: input.projectId,
          resourceId: input.resourceId,
          gitRepoUrl: rec.compose.gitRepoUrl,
          gitRef: rec.compose.gitRef,
          // The row's binding (if picked) → authenticated SHA + private clone.
          gitRepoId: rec.compose.gitRepoId,
          reason: "redeploy",
        });
        return enq.isOk()
          ? { ok: true, error: null, status: "building" }
          : { ok: false, error: enq.error, status: "failed" };
      }

      const d = await deployCompose(
        { projectId: input.projectId, resourceId: input.resourceId },
        "redeploy",
        context.log,
      );
      return d.isOk()
        ? { ok: true, error: null, status: d.value.status }
        : { ok: false, error: d.error.message, status: "failed" };
    },
  ),

  // Change which service:port pairs are publicly exposed on a live stack. Drops
  // exposures that don't reference a real service, persists the list, then
  // re-mints the Caddy routes (reconcileComposeDomains is idempotent: it clears
  // the stack's generated routes and re-creates one per exposure).
  setExposed: requirePermission({ service: ["update"] }).compose.setExposed.handler(
    async ({ input, context, errors }) => {
      const rec = await getComposeRecord(input.projectId, input.resourceId);
      if (!rec) throw errors.NOT_FOUND();
      const project = await getProjectInOrg({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (!project) throw errors.NOT_FOUND();

      const known = new Set(rec.compose.services.map((s) => s.name));
      const exposed = input.exposed
        .filter((e) => known.has(e.service))
        .map((e) => ({ service: e.service, port: e.port, domain: e.domain }));

      await updateComposeExposed({ resourceId: input.resourceId, exposed });
      const updated = (await getComposeRecord(input.projectId, input.resourceId)) ?? rec;
      await reconcileComposeDomains(updated, {
        id: input.projectId,
        slug: project.slug,
      });
      return toView(updated);
    },
  ),

  delete: requirePermission({ service: ["delete"] }).compose.delete.handler(
    async ({ input, context, errors }) => {
      const rec = await getComposeRecord(input.projectId, input.resourceId);
      if (!rec) throw errors.NOT_FOUND();
      // Tear down each child service resource (swarm service + routes + row),
      // then the stack's own routes + record. removeComposeStack also clears any
      // legacy services still labelled with the stack id (pre-real-resource).
      // Capture the stack's seeded `${VAR}` keys before its record is gone.
      const composeContent = rec.compose.composeContent;
      await removeStackServices(input.resourceId, context.log);
      await removeComposeStack({ resourceId: input.resourceId }, context.log);
      await removeComposeDomains(input.resourceId);
      await deleteComposeRecord(input.projectId, input.resourceId);
      // Drop the stack's host artifact dir (deleteComposeRecord removes the row
      // directly, bypassing deleteResourceById's cleanup). No-op unless the data
      // folder is in use.
      await removeResourceDir(input.projectId, input.resourceId);
      // Drop the project variables this stack seeded that nothing else uses.
      await cleanupOrphanedComposeVars(
        {
          projectId: input.projectId,
          deletedResourceId: input.resourceId,
          composeContent,
        },
        context.log,
      );
      return { ok: true };
    },
  ),
};
