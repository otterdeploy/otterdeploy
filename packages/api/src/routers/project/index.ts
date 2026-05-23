import { matchError } from "better-result";

import { orgScopedProcedure } from "../../index";

import {
  createPostgresResource,
  createProject,
  deletePostgresResource,
  deleteProject,
  getPostgresResource,
  getProject,
  listPostgresResources,
  listProjectProxyRoutes,
  listProjects,
  updateProject,
} from "./handlers";

export const projectRouter = {
  get: orgScopedProcedure.project.get.handler(
    async ({ input, context, errors }) => {
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
    },
  ),

  list: orgScopedProcedure.project.list.handler(async ({ context }) => {
    return listProjects({ organizationId: context.activeOrganizationId });
  }),

  create: orgScopedProcedure.project.create.handler(
    async ({ input, context, errors }) => {
      const result = await createProject({
        ...input,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectConflictError: () => errors.CONFLICT(),
        });
      }
      return result.value;
    },
  ),

  update: orgScopedProcedure.project.update.handler(
    async ({ input, context, errors }) => {
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

  delete: orgScopedProcedure.project.delete.handler(
    async ({ input, context, errors }) => {
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

  proxyRoute: {
    list: orgScopedProcedure.project.proxyRoute.list.handler(
      async ({ input, context, errors }) => {
        const result = await listProjectProxyRoutes({
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
  },

  database: {
    postgres: {
      create: orgScopedProcedure.project.database.postgres.create.handler(
        async ({ input, context, errors }) => {
          const result = await createPostgresResource(
            {
              ...input,
              projectId: input.projectId,
              organizationId: context.activeOrganizationId,
            },
            context.log,
          );
          if (result.isErr()) {
            throw matchError(result.error, {
              ProjectNotFoundError: () => errors.NOT_FOUND(),
              PostgresResourceConflictError: () => errors.CONFLICT(),
            });
          }
          return result.value;
        },
      ),

      list: orgScopedProcedure.project.database.postgres.list.handler(
        async ({ input, context, errors }) => {
          const result = await listPostgresResources({
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

      get: orgScopedProcedure.project.database.postgres.get.handler(
        async ({ input, context, errors }) => {
          const result = await getPostgresResource({
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
        },
      ),

      delete: orgScopedProcedure.project.database.postgres.delete.handler(
        async ({ input, context, errors }) => {
          const result = await deletePostgresResource(
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
    },
  },
};
