import { matchError } from "better-result";

import { orgScopedProcedure } from "../../index";

import {
  bulkSetResourceEnv,
  checkResourceName,
  createPostgresResourceStream,
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
  listResourceDeployments,
  listResourceTasks,
  listTasksForDeployment,
  tailDeploymentLogs,
  tailResourceLogs,
  tailTaskLogs,
  updateProject,
  validatePostgresCreate,
} from "./handlers";
import { tailProjectLogs } from "./project-logs";

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
              secretKeys: input.secretKeys,
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
          });
        },
      ),
    },

    taskLogs: {
      // Per-task variant — drives the deployment-detail expander. Same
      // eager-handler pattern as logs.tail above: log.set runs before the
      // generator body so evlog sees the target fields.
      tail: orgScopedProcedure.project.resource.taskLogs.tail.handler(
        ({ input, context }) => {
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
        },
      ),
    },

    deployments: {
      list: orgScopedProcedure.project.resource.deployments.list.handler(
        async ({ input, context, errors }) => {
          context.log.set({
            target: { type: "resource", id: input.resourceId, projectId: input.projectId },
          });
          const result = await listResourceDeployments({
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
          return result.value.map((d) => ({
            ...d,
            completedAt: d.completedAt ? d.completedAt.toISOString() : null,
            createdAt: d.createdAt.toISOString(),
            updatedAt: d.updatedAt.toISOString(),
          }));
        },
      ),

      tasks: orgScopedProcedure.project.resource.deployments.tasks.handler(
        async ({ input, context, errors }) => {
          context.log.set({
            target: { type: "resource", id: input.resourceId, projectId: input.projectId },
            deploymentId: input.deploymentId,
          });
          const result = await listTasksForDeployment({
            projectId: input.projectId,
            resourceId: input.resourceId,
            organizationId: context.activeOrganizationId,
            deploymentId: input.deploymentId,
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

      logs: {
        tail: orgScopedProcedure.project.resource.deployments.logs.tail.handler(
          ({ input, context }) => {
            context.log.set({
              target: {
                type: "resource",
                id: input.resourceId,
                projectId: input.projectId,
              },
              deploymentId: input.deploymentId,
            });
            return tailDeploymentLogs({
              projectId: input.projectId,
              resourceId: input.resourceId,
              organizationId: context.activeOrganizationId,
              deploymentId: input.deploymentId,
              tail: input.tail,
            });
          },
        ),
      },
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
        // Streaming create. Pre-flight validation (project lookup + name
        // conflict) happens BEFORE the stream opens — those failures throw
        // matched oRPC errors. Once the generator runs, runtime failures
        // surface as `error` events the wizard renders alongside the
        // already-completed steps.
        create: orgScopedProcedure.project.resource.database.postgres.create.handler(
          // Eager prelude. Everything that should land in the audit wide
          // event has to run BEFORE we return the generator — once that
          // happens oRPC sets up the streaming response, hono's `next()`
          // resolves, and evlog flushes. Anything log.set() inside the
          // generator body gets dropped with a warning.
          async ({ input, context, errors }) => {
            context.log.set({
              target: {
                type: "resource",
                kind: "postgres",
                projectId: input.projectId,
                name: input.name,
              },
            });

            const validation = await validatePostgresCreate({
              projectId: input.projectId,
              organizationId: context.activeOrganizationId,
              name: input.name,
            });
            if (validation.isErr()) {
              throw matchError(validation.error, {
                ProjectNotFoundError: () => errors.NOT_FOUND(),
                PostgresResourceConflictError: () => errors.CONFLICT(),
              });
            }

            // The resource id only exists after the db-record step yields,
            // long after the wide event flushed. Clients still receive it
            // via the `created` event payload.
            return createPostgresResourceStream(
              {
                ...input,
                projectId: input.projectId,
                organizationId: context.activeOrganizationId,
                project: validation.value.project,
              },
              context.log,
            );
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
};
