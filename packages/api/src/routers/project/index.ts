import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
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
import { tailProjectLogs } from "./project-logs";
import { listAvailableRefs } from "./refs";
import { envVarRouter } from "./router-env-var";
import { manifestRouter } from "./router-manifest";
import { proxyRouteRouter } from "./router-proxy-routes";
import { resourceRouter } from "./router-resource";
import { stackRouter } from "./router-stack";

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
          ProjectInvalidBindingError: () => errors.INVALID_BINDING(),
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
