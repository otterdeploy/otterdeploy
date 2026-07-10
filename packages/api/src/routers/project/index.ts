import type { OrganizationId, PreviewId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import { ProjectNotFoundError } from "./errors";
import { streamProjectEvents, validateProjectEventsStream } from "./events-stream";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectBySlugForOrg,
  listProjectDependencies,
  listProjects,
  listProjectServiceTasks,
  saveProjectGraphLayout,
  updateProject,
} from "./handlers";
import {
  disablePreviewDbBranch,
  enablePreviewDbBranch,
  pausePreview,
  rebuildPreview,
  redeployPreview,
  resetPreviewDbBranch,
  resumePreview,
  setPreviewKeepAlive,
  teardownPreviewNow,
} from "./previews-controls";
import {
  listPreviewEffectiveEnv,
  listPreviewEnvOverrides,
  setPreviewEnvOverride,
  unsetPreviewEnvOverride,
} from "./previews-env";
import { listProjectPreviews } from "./previews-list";
import { tailProjectLogs } from "./project-logs";
import { listAvailableRefs } from "./refs";
import { envVarRouter } from "./router-env-var";
import { manifestRouter } from "./router-manifest";
import { proxyRouteRouter } from "./router-proxy-routes";
import { resourceRouter } from "./router-resource";
import { stackRouter } from "./router-stack";

// Shared boilerplate for preview-level POST controls (rebuild/pause/etc.):
// stamp the log target, call the handler with the org-scoped input, map the
// not-found error. The control handlers all take (scope, log?) and return a
// Result<record, ProjectNotFoundError>.
async function previewCtl<T>(
  fn: (
    input: { projectId: ProjectId; previewId: PreviewId; organizationId: OrganizationId },
    log?: RequestLogger,
  ) => Promise<import("better-result").Result<T, InstanceType<typeof ProjectNotFoundError>>>,
  input: { projectId: ProjectId; previewId: PreviewId },
  context: { activeOrganizationId: OrganizationId; log: RequestLogger },
  errors: { NOT_FOUND: () => unknown },
): Promise<T> {
  context.log.set({ target: { type: "project", id: input.projectId } });
  const result = await fn(
    {
      projectId: input.projectId,
      previewId: input.previewId,
      organizationId: context.activeOrganizationId,
    },
    context.log,
  );
  if (result.isErr()) {
    throw matchError(result.error, { ProjectNotFoundError: () => errors.NOT_FOUND() });
  }
  return result.value;
}

export const projectRouter = {
  get: orgScopedProcedure.project.get.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.id } });
    const result = await getProject({
      id: input.id,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  getBySlug: orgScopedProcedure.project.getBySlug.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", slug: input.slug } });
    const result = await getProjectBySlugForOrg({
      slug: input.slug,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    context.log.set({
      target: { type: "project", id: result.value.id, slug: input.slug },
    });
    return result.value;
  }),

  list: orgScopedProcedure.project.list.handler(async ({ context }) => {
    return listProjects({ organizationId: context.activeOrganizationId });
  }),

  create: requirePermission({ project: ["create"] }).project.create.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project" } });
      const result = await createProject({
        ...input,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectConflictError: () => errors.CONFLICT(),
        });
      }
      context.log.set({ target: { type: "project", id: result.value.id } });
      return result.value;
    },
  ),

  update: requirePermission({ project: ["update"] }).project.update.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.id } });
      const result = await updateProject({
        ...input,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ProjectConflictError: () => errors.CONFLICT(),
        });
      }
      return result.value;
    },
  ),

  delete: requirePermission({ project: ["delete"] }).project.delete.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.id } });
      const result = await deleteProject(
        {
          id: input.id,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ProjectHasServicesError: (e) =>
            errors.CONFLICT({ data: { serviceCount: e.serviceCount } }),
        });
      }
      return result.value;
    },
  ),

  saveGraphLayout: requirePermission({ project: ["update"] }).project.saveGraphLayout.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.id } });
      const result = await saveProjectGraphLayout({
        projectId: input.id,
        organizationId: context.activeOrganizationId,
        positions: input.positions,
        replace: input.replace,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  dependencies: orgScopedProcedure.project.dependencies.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await listProjectDependencies({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  serviceTasks: orgScopedProcedure.project.serviceTasks.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await listProjectServiceTasks({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  proxyRoute: proxyRouteRouter,

  previews: {
    list: orgScopedProcedure.project.previews.list.handler(async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await listProjectPreviews({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    }),

    rebuild: requirePermission({ service: ["deploy"] }).project.previews.rebuild.handler(
      async ({ input, context, errors }) => previewCtl(rebuildPreview, input, context, errors),
    ),
    redeploy: requirePermission({ service: ["deploy"] }).project.previews.redeploy.handler(
      async ({ input, context, errors }) => previewCtl(redeployPreview, input, context, errors),
    ),
    pause: requirePermission({ service: ["deploy"] }).project.previews.pause.handler(
      async ({ input, context, errors }) => previewCtl(pausePreview, input, context, errors),
    ),
    resume: requirePermission({ service: ["deploy"] }).project.previews.resume.handler(
      async ({ input, context, errors }) => previewCtl(resumePreview, input, context, errors),
    ),
    teardown: requirePermission({ service: ["delete"] }).project.previews.teardown.handler(
      async ({ input, context, errors }) => previewCtl(teardownPreviewNow, input, context, errors),
    ),
    keepAlive: requirePermission({ service: ["update"] }).project.previews.keepAlive.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "project", id: input.projectId } });
        const result = await setPreviewKeepAlive({
          projectId: input.projectId,
          previewId: input.previewId,
          organizationId: context.activeOrganizationId,
          keepAlive: input.keepAlive,
        });
        if (result.isErr()) {
          throw matchError(result.error, { ProjectNotFoundError: () => errors.NOT_FOUND() });
        }
        return result.value;
      },
    ),
    dbBranch: {
      enable: requirePermission({ database: ["update"] }).project.previews.dbBranch.enable.handler(
        async ({ input, context, errors }) =>
          previewCtl(enablePreviewDbBranch, input, context, errors),
      ),
      disable: requirePermission({
        database: ["update"],
      }).project.previews.dbBranch.disable.handler(async ({ input, context, errors }) =>
        previewCtl(disablePreviewDbBranch, input, context, errors),
      ),
      reset: requirePermission({ database: ["update"] }).project.previews.dbBranch.reset.handler(
        async ({ input, context, errors }) =>
          previewCtl(resetPreviewDbBranch, input, context, errors),
      ),
    },

    envVars: {
      effective: orgScopedProcedure.project.previews.envVars.effective.handler(
        async ({ input, context, errors }) => {
          context.log.set({ target: { type: "project", id: input.projectId } });
          const result = await listPreviewEffectiveEnv({
            ...input,
            organizationId: context.activeOrganizationId,
          });
          if (result.isErr()) {
            throw matchError(result.error, { ProjectNotFoundError: () => errors.NOT_FOUND() });
          }
          return result.value;
        },
      ),
      list: orgScopedProcedure.project.previews.envVars.list.handler(
        async ({ input, context, errors }) => {
          context.log.set({ target: { type: "project", id: input.projectId } });
          const result = await listPreviewEnvOverrides({
            ...input,
            organizationId: context.activeOrganizationId,
          });
          if (result.isErr()) {
            throw matchError(result.error, {
              ProjectNotFoundError: () => errors.NOT_FOUND(),
            });
          }
          return result.value;
        },
      ),
      set: requirePermission({ env: ["update"] }).project.previews.envVars.set.handler(
        async ({ input, context, errors }) => {
          context.log.set({ target: { type: "project", id: input.projectId } });
          const result = await setPreviewEnvOverride(
            { ...input, organizationId: context.activeOrganizationId },
            context.log,
          );
          if (result.isErr()) {
            throw matchError(result.error, {
              ProjectNotFoundError: () => errors.NOT_FOUND(),
            });
          }
          return result.value;
        },
      ),
      unset: requirePermission({ env: ["update"] }).project.previews.envVars.unset.handler(
        async ({ input, context, errors }) => {
          context.log.set({ target: { type: "project", id: input.projectId } });
          const result = await unsetPreviewEnvOverride(
            { ...input, organizationId: context.activeOrganizationId },
            context.log,
          );
          if (result.isErr()) {
            throw matchError(result.error, {
              ProjectNotFoundError: () => errors.NOT_FOUND(),
            });
          }
          return result.value;
        },
      ),
    },
  },

  resource: resourceRouter,

  manifest: manifestRouter,

  logs: {
    // Project-wide fan-in tail. Snapshots services at subscribe time;
    // operator reconnects on resource list changes from the client.
    tail: orgScopedProcedure.project.logs.tail.handler(({ input, context }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      return tailProjectLogs({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
        resourceIds: input.resourceIds,
        tail: input.tail,
      });
    }),
  },

  refs: {
    list: orgScopedProcedure.project.refs.list.handler(async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await listAvailableRefs({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    }),
  },

  envVar: envVarRouter,

  events: {
    stream: orgScopedProcedure.project.events.stream.handler(async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const pre = await validateProjectEventsStream({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (pre.isErr()) {
        throw matchError(pre.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return streamProjectEvents({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
    }),
  },

  stack: stackRouter,
};
