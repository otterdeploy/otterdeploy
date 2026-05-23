import { orgScopedProcedure } from "../..";

import {
  createProject,
  createPostgresResource,
  deletePostgresResource,
  getProject,
  getPostgresResource,
  listProjects,
  listPostgresResources,
  listProjectProxyRoutes,
} from "./service";

export const projectRouter = {
  get: orgScopedProcedure.project.get.handler(async ({ input, context, errors }) => {
    const result = await getProject({
      ...input,
      organizationId: context.activeOrganizationId,
    });
    if (!result.ok) {
      throw errors.NOT_FOUND();
    }
    return result.project;
  }),
  list: orgScopedProcedure.project.list.handler(async ({ context }) => {
    return listProjects({ organizationId: context.activeOrganizationId });
  }),
  create: orgScopedProcedure.project.create.handler(async ({ input, context, errors }) => {
    const result = await createProject({
      ...input,
      organizationId: context.activeOrganizationId,
    });
    if (!result.ok) {
      throw errors.CONFLICT();
    }
    return result.project;
  }),
  proxyRoute: {
    list: orgScopedProcedure.project.proxyRoute.list.handler(
      async ({ input, context, errors }) => {
        const result = await listProjectProxyRoutes({
          ...input,
          organizationId: context.activeOrganizationId,
        });
        if (!result.ok) {
          throw errors.NOT_FOUND();
        }
        return result.routes;
      },
    ),
  },
  database: {
    createPostgres: orgScopedProcedure.project.database.createPostgres.handler(
      async ({ input, context, errors }) => {
        const result = await createPostgresResource(
          { ...input, organizationId: context.activeOrganizationId },
          context.log,
        );
        if (!result.ok) {
          if (result.reason === "project_not_found") {
            throw errors.NOT_FOUND();
          }
          throw errors.CONFLICT();
        }
        return result.resource;
      },
    ),
    listPostgres: orgScopedProcedure.project.database.listPostgres.handler(
      async ({ input, context, errors }) => {
        const result = await listPostgresResources({
          ...input,
          organizationId: context.activeOrganizationId,
        });
        if (!result.ok) {
          throw errors.NOT_FOUND();
        }
        return result.resources;
      },
    ),
    getPostgres: orgScopedProcedure.project.database.getPostgres.handler(
      async ({ input, context, errors }) => {
        const result = await getPostgresResource({
          ...input,
          organizationId: context.activeOrganizationId,
        });
        if (!result.ok) {
          throw errors.NOT_FOUND();
        }
        return result.resource;
      },
    ),
    deletePostgres: orgScopedProcedure.project.database.deletePostgres.handler(
      async ({ input, context, errors }) => {
        const result = await deletePostgresResource(
          { ...input, organizationId: context.activeOrganizationId },
          context.log,
        );
        if (!result.ok) {
          throw errors.NOT_FOUND();
        }
        return { ok: true };
      },
    ),
  },
};
