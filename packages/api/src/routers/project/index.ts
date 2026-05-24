import { matchError } from "better-result";

import { orgScopedProcedure } from "../../index";

import {
  createPostgresResource,
  createProject,
  deleteProject,
  deleteProjectResource,
  getProject,
  getProjectBySlugForOrg,
  getProjectResource,
  listProjectProxyRoutes,
  listProjectResources,
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

  getBySlug: orgScopedProcedure.project.getBySlug.handler(
    async ({ input, context, errors }) => {
      const result = await getProjectBySlugForOrg({
        slug: input.slug,
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

  resource: {
    list: orgScopedProcedure.project.resource.list.handler(
      async ({ input, context, errors }) => {
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
      },
    ),

    get: orgScopedProcedure.project.resource.get.handler(
      async ({ input, context, errors }) => {
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
      },
    ),

    delete: orgScopedProcedure.project.resource.delete.handler(
      async ({ input, context, errors }) => {
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
      postgres: {
        create: orgScopedProcedure.project.resource.database.postgres.create.handler(
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
      },
    },
  },
};
