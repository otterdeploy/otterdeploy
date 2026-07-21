import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import {
  bulkSetResourceEnv,
  checkResourceName,
  deleteProjectResource,
  getProjectResource,
  listProjectResources,
  listResourceEnv,
  listResourceTasks,
  tailResourceLogs,
  tailTaskLogs,
} from "./handlers";
import { deploymentsResourceRouter } from "./router-resource-deployments";
import { postgresResourceRouter } from "./router-resource-postgres";

export const resourceRouter = {
  list: orgScopedProcedure.project.resource.list.handler(async ({ input, context, errors }) => {
    const result = await listProjectResources({
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

  checkName: orgScopedProcedure.project.resource.checkName.handler(
    async ({ input, context, errors }) => {
      const result = await checkResourceName({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
        name: input.name,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  tasks: orgScopedProcedure.project.resource.tasks.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const result = await listResourceTasks({
      projectId: input.projectId,
      resourceId: input.resourceId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
        PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  env: {
    list: orgScopedProcedure.project.resource.env.list.handler(
      async ({ input, context, errors }) => {
        context.log.set({
          target: { type: "resource", id: input.resourceId, projectId: input.projectId },
        });
        const result = await listResourceEnv({
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
        });
        if (result.isErr()) {
          throw matchError(result.error, {
            ProjectNotFoundError: () => errors.NOT_FOUND(),
            PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
          });
        }
        return result.value;
      },
    ),

    bulkSet: requirePermission({ env: ["update"] }).project.resource.env.bulkSet.handler(
      async ({ input, context, errors }) => {
        context.log.set({
          target: { type: "resource", id: input.resourceId, projectId: input.projectId },
        });
        const result = await bulkSetResourceEnv(
          {
            projectId: input.projectId,
            resourceId: input.resourceId,
            organizationId: context.activeOrganizationId,
            env: input.env,
            secretKeys: input.secretKeys,
            redeploy: input.redeploy,
          },
          context.log,
        );
        if (result.isErr()) {
          throw matchError(result.error, {
            ProjectNotFoundError: () => errors.NOT_FOUND(),
            PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
          });
        }
        return result.value;
      },
    ),
  },

  logs: {
    // Streaming. The handler is an async generator that yields demuxed
    // log lines until the client disconnects. Resource ownership is
    // verified inside tailResourceLogs (it calls getProjectInOrg) so
    // cross-tenant log access can't happen.
    tail: orgScopedProcedure.project.resource.logs.tail.handler(
      // Eager handler that returns the iterator synchronously. We MUST
      // call context.log.set() before the body becomes a streaming
      // response — otherwise evlog has already flushed the wide event by
      // the time the generator's body would run, and the fields land in
      // /dev/null. Same reason the `postgres.create` handler does
      // validation + log.set eagerly before returning its generator.
      ({ input, context }) => {
        context.log.set({
          target: { type: "resource", id: input.resourceId, projectId: input.projectId },
        });
        return tailResourceLogs({
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          tail: input.tail,
          follow: input.follow,
          since: input.since,
        });
      },
    ),
  },

  taskLogs: {
    // Per-task variant — drives the deployment-detail expander. Same
    // eager-handler pattern as logs.tail above: log.set runs before the
    // generator body so evlog sees the target fields.
    tail: orgScopedProcedure.project.resource.taskLogs.tail.handler(({ input, context }) => {
      context.log.set({
        target: {
          type: "resource",
          id: input.resourceId,
          projectId: input.projectId,
        },
        taskId: input.taskId,
      });
      return tailTaskLogs({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
        taskId: input.taskId,
        tail: input.tail,
      });
    }),
  },

  deployments: deploymentsResourceRouter,

  get: orgScopedProcedure.project.resource.get.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const result = await getProjectResource({
      projectId: input.projectId,
      resourceId: input.resourceId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  delete: requirePermission({ service: ["delete"] }).project.resource.delete.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await deleteProjectResource(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  database: {
    postgres: postgresResourceRouter,
  },
};
