import { orgScopedProcedure } from "../..";

import { type ResourceId } from "../service/errors";

import { type ProjectId } from "./errors";
import {
  createPostgresResource,
  createProject,
  deletePostgresResource,
  getPostgresResource,
  getProject,
  listPostgresResources,
  listProjectProxyRoutes,
  listProjects,
} from "./handlers";

export const projectRouter = {
  get: orgScopedProcedure.project.get.handler(async ({ input, context, errors }) => {
    const result = await getProject({
      id: input.id as ProjectId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      switch (result.error._tag) {
        case "ProjectNotFoundError":
          throw errors.NOT_FOUND();
      }
    }
    return result.value;
  }),

  list: orgScopedProcedure.project.list.handler(async ({ context }) => {
    return listProjects({ organizationId: context.activeOrganizationId });
  }),

  create: orgScopedProcedure.project.create.handler(async ({ input, context, errors }) => {
    const result = await createProject({
      ...input,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      switch (result.error._tag) {
        case "ProjectConflictError":
          throw errors.CONFLICT();
      }
    }
    return result.value;
  }),

  proxyRoute: {
    list: orgScopedProcedure.project.proxyRoute.list.handler(
      async ({ input, context, errors }) => {
        const result = await listProjectProxyRoutes({
          projectId: input.projectId as ProjectId,
          organizationId: context.activeOrganizationId,
        });
        if (result.isErr()) {
          switch (result.error._tag) {
            case "ProjectNotFoundError":
              throw errors.NOT_FOUND();
          }
        }
        return result.value;
      },
    ),
  },

  database: {
    createPostgres: orgScopedProcedure.project.database.createPostgres.handler(
      async ({ input, context, errors }) => {
        const result = await createPostgresResource(
          {
            ...input,
            projectId: input.projectId as ProjectId,
            organizationId: context.activeOrganizationId,
          },
          context.log,
        );
        if (result.isErr()) {
          switch (result.error._tag) {
            case "ProjectNotFoundError":
              throw errors.NOT_FOUND();
            case "PostgresResourceConflictError":
              throw errors.CONFLICT();
          }
        }
        return result.value;
      },
    ),

    listPostgres: orgScopedProcedure.project.database.listPostgres.handler(
      async ({ input, context, errors }) => {
        const result = await listPostgresResources({
          projectId: input.projectId as ProjectId,
          organizationId: context.activeOrganizationId,
        });
        if (result.isErr()) {
          switch (result.error._tag) {
            case "ProjectNotFoundError":
              throw errors.NOT_FOUND();
          }
        }
        return result.value;
      },
    ),

    getPostgres: orgScopedProcedure.project.database.getPostgres.handler(
      async ({ input, context, errors }) => {
        const result = await getPostgresResource({
          projectId: input.projectId as ProjectId,
          resourceId: input.resourceId as ResourceId,
          organizationId: context.activeOrganizationId,
        });
        if (result.isErr()) {
          switch (result.error._tag) {
            case "PostgresResourceNotFoundError":
              throw errors.NOT_FOUND();
          }
        }
        return result.value;
      },
    ),

    deletePostgres: orgScopedProcedure.project.database.deletePostgres.handler(
      async ({ input, context, errors }) => {
        const result = await deletePostgresResource(
          {
            projectId: input.projectId as ProjectId,
            resourceId: input.resourceId as ResourceId,
            organizationId: context.activeOrganizationId,
          },
          context.log,
        );
        if (result.isErr()) {
          switch (result.error._tag) {
            case "PostgresResourceNotFoundError":
              throw errors.NOT_FOUND();
          }
        }
        return result.value;
      },
    ),
  },
};
