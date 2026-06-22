/**
 * oRPC handlers for `type: compose` resources. Thin wrappers over the compose
 * service layer (parse / queries / deploy). See docs/designs/compose.md.
 */
import { Result } from "better-result";

import { projectScopedProcedure, requirePermission } from "../..";
import { fetchBranchHeadSha } from "../../git/github-app";
import { parseCompose, summarizeCompose } from "../../stack/compose";
import { upsertProjectEnvVar } from "../project/queries";
import { collectVarRefs, interpolate } from "./env";
import { parseGitHubUrl, SECRETISH, stackNameFor } from "./util";
import { removeComposeStack } from "../../swarm";
import { getProjectInOrg } from "../project/queries";
import { isUniqueViolation } from "../project/views";

import { removeResourceDir } from "../../lib/data-dir";
import { enqueueComposeBuild } from "./build-trigger";
import { cleanupOrphanedComposeVars } from "./cleanup-vars";
import {
  deployCompose,
  reconcileComposeDomains,
  removeComposeDomains,
} from "./deploy";
import { removeStackServices } from "./reconcile";
import {
  type ComposeRecord,
  createComposeRecord,
  deleteComposeRecord,
  getComposeRecord,
  listComposeRecords,
  updateComposeExposed,
} from "./queries";

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

  get: projectScopedProcedure.compose.get.handler(
    async ({ input, errors }) => {
      const rec = await getComposeRecord(input.projectId, input.resourceId);
      if (!rec) throw errors.NOT_FOUND();
      return toView(rec);
    },
  ),

  // A compose stack is a group of services, so it rides the `service`
  // permissions (members create/redeploy, only admins/owners delete).
  create: requirePermission({ service: ["create"] }).compose.create.handler(
    async ({ input, context, errors }) => {
      const project = await getProjectInOrg({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (!project) throw errors.NOT_FOUND();

      // Persist the filled-in `${VAR}` values as project variables so the
      // interpolation (and any future redeploy) resolves them. Applies to both
      // inline and git sources.
      if (input.variables.length > 0 && project.environmentId) {
        for (const v of input.variables) {
          if (!v.value) continue;
          await upsertProjectEnvVar({
            scope: {
              projectId: input.projectId,
              environmentId: project.environmentId,
            },
            key: v.key,
            value: v.value,
            isSecret: v.secret ?? SECRETISH.test(v.key),
          });
        }
      }

      const exposed = input.exposed.map((e) => ({
        service: e.service,
        port: e.port,
        domain: "",
      }));
      // ── Git source: build the stack from a public repo URL. ──
      if (input.source === "git") {
        const gh = parseGitHubUrl(input.gitRepoUrl ?? "");
        if (!gh) {
          throw errors.INVALID_INPUT({
            message: "Enter a public GitHub repo URL, e.g. https://github.com/owner/repo",
          });
        }
        // Name from the user, else the repo name.
        const name = input.name?.trim() || gh.repo;
        const stackName = stackNameFor(project.slug, name);
        const branch = input.gitRef?.trim() || "main";
        const shaRes = await Result.tryPromise({
          try: () => fetchBranchHeadSha(null, gh.owner, gh.repo, branch),
          catch: (e) => (e instanceof Error ? e.message : String(e)),
        });
        if (shaRes.isErr()) {
          throw errors.INVALID_INPUT({
            message: `Couldn't resolve ${branch} on ${gh.owner}/${gh.repo}: ${shaRes.error}`,
          });
        }
        const ref = `refs/heads/${branch}`;

        const created = await Result.tryPromise({
          try: () =>
            createComposeRecord({
              projectId: input.projectId,
              name,
              source: "git",
              composeContent: null,
              gitRepoUrl: gh.cloneUrl,
              gitRef: ref,
              // null → the build worker auto-detects common compose file names.
              composePath: input.composePath?.trim() || null,
              stackName,
              services: [],
              exposed,
            }),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        });
        if (created.isErr()) {
          if (isUniqueViolation(created.error)) throw errors.CONFLICT();
          throw created.error;
        }

        await enqueueComposeBuild({
          projectId: input.projectId,
          resourceId: created.value.resource.id,
          gitRepoUrl: gh.cloneUrl,
          gitRef: ref,
          projectGitRepoId: project.gitRepoId ?? null,
          reason: "create",
          sha: shaRes.value,
        });

        return {
          resourceId: created.value.resource.id,
          services: [],
          warnings: [],
          deploy: { ok: true, error: null, status: "building" },
        };
      }

      // ── Inline source: parse + deploy now (no build worker). ──
      if (!input.composeContent) {
        throw errors.INVALID_INPUT({ message: "Compose file is empty" });
      }
      const parsed = parseCompose(input.composeContent);
      if (parsed.isErr()) {
        throw errors.INVALID_INPUT({ message: parsed.error.message });
      }
      const services = summarizeCompose(parsed.value);
      // Name from the user, else the file's `name:`, else its first service.
      const name =
        input.name?.trim() ||
        parsed.value.name ||
        parsed.value.services[0]?.name ||
        "compose-stack";
      const stackName = stackNameFor(project.slug, name);

      const created = await Result.tryPromise({
        try: () =>
          createComposeRecord({
            projectId: input.projectId,
            name,
            source: "inline",
            composeContent: input.composeContent ?? null,
            stackName,
            services,
            exposed,
          }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });
      if (created.isErr()) {
        if (isUniqueViolation(created.error)) throw errors.CONFLICT();
        throw created.error;
      }

      context.log.set({
        target: {
          type: "resource",
          kind: "compose",
          id: created.value.resource.id,
          projectId: input.projectId,
        },
      });

      let deploy = { ok: false, error: null as string | null, status: "created" };
      if (input.deploy) {
        const d = await deployCompose(
          { projectId: input.projectId, resourceId: created.value.resource.id },
          "create",
          context.log,
        );
        deploy = d.isOk()
          ? { ok: true, error: null, status: d.value.status }
          : { ok: false, error: d.error.message, status: "failed" };
      }

      return {
        resourceId: created.value.resource.id,
        services,
        warnings: parsed.value.warnings,
        deploy,
      };
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
          projectGitRepoId: null,
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
      const updated =
        (await getComposeRecord(input.projectId, input.resourceId)) ?? rec;
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
