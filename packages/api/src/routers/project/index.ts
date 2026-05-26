import { matchError } from "better-result";

import { orgScopedProcedure } from "../../index";

import {
  bulkSetResourceEnv,
  checkResourceName,
  createPostgresResource,
  setPostgresPublic,
  setPostgresExtraEnvKey,
  unsetPostgresExtraEnvKey,
  createProject,
  deleteProject,
  deleteProjectResource,
  getProject,
  getProjectBySlugForOrg,
  getProjectResource,
  listProjectDependencies,
  listProjectProxyRoutes,
  listProjectResources,
  listProjects,
  listProjectServiceTasks,
  listResourceEnv,
  listResourceTasks,
  updateProject,
} from "./handlers";

export const projectRouter = {
  get: orgScopedProcedure.project.get.handler(
    async ({ input, context, errors }) => {
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
    },
  ),

  getBySlug: orgScopedProcedure.project.getBySlug.handler(
    async ({ input, context, errors }) => {
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
    },
  ),

  list: orgScopedProcedure.project.list.handler(async ({ context }) => {
    return listProjects({ organizationId: context.activeOrganizationId });
  }),

  create: orgScopedProcedure.project.create.handler(
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

  update: orgScopedProcedure.project.update.handler(
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

  delete: orgScopedProcedure.project.delete.handler(
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

    tasks: orgScopedProcedure.project.resource.tasks.handler(
      async ({ input, context, errors }) => {
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
      },
    ),

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

      bulkSet: orgScopedProcedure.project.resource.env.bulkSet.handler(
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

    get: orgScopedProcedure.project.resource.get.handler(
      async ({ input, context, errors }) => {
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
      },
    ),

    delete: orgScopedProcedure.project.resource.delete.handler(
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
      postgres: {
        create: orgScopedProcedure.project.resource.database.postgres.create.handler(
          async ({ input, context, errors }) => {
            context.log.set({
              target: { type: "resource", kind: "postgres", projectId: input.projectId },
            });
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
            context.log.set({
              target: {
                type: "resource",
                kind: "postgres",
                id: result.value.resourceId,
                projectId: input.projectId,
              },
            });
            return result.value;
          },
        ),

        setPublic: orgScopedProcedure.project.resource.database.postgres.setPublic.handler(
          async ({ input, context, errors }) => {
            context.log.set({
              target: {
                type: "resource",
                kind: "postgres",
                id: input.resourceId,
                projectId: input.projectId,
              },
            });
            const result = await setPostgresPublic(
              {
                projectId: input.projectId,
                resourceId: input.resourceId,
                publicEnabled: input.publicEnabled,
                organizationId: context.activeOrganizationId,
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

        setExtraEnv:
          orgScopedProcedure.project.resource.database.postgres.setExtraEnv.handler(
            async ({ input, context, errors }) => {
              context.log.set({
                target: {
                  type: "resource",
                  kind: "postgres",
                  id: input.resourceId,
                  projectId: input.projectId,
                },
                envKey: input.key,
              });
              const result = await setPostgresExtraEnvKey(
                {
                  projectId: input.projectId,
                  resourceId: input.resourceId,
                  key: input.key,
                  value: input.value,
                  organizationId: context.activeOrganizationId,
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

        unsetExtraEnv:
          orgScopedProcedure.project.resource.database.postgres.unsetExtraEnv.handler(
            async ({ input, context, errors }) => {
              context.log.set({
                target: {
                  type: "resource",
                  kind: "postgres",
                  id: input.resourceId,
                  projectId: input.projectId,
                },
                envKey: input.key,
              });
              const result = await unsetPostgresExtraEnvKey(
                {
                  projectId: input.projectId,
                  resourceId: input.resourceId,
                  key: input.key,
                  organizationId: context.activeOrganizationId,
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
    },
  },
};
