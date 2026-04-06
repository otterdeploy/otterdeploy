import { publicProcedure } from "../..";

import {
  createProject,
  createPostgresResource,
  getProject,
  getPostgresResource,
  listProjects,
  listPostgresResources,
  listProjectProxyRoutes,
} from "./service";

export const projectRouter = {
  get: publicProcedure.project.get.handler(async ({ input, errors }) => {
    const result = await getProject(input);
    if (!result.ok) {
      throw errors.NOT_FOUND();
    }
    return result.project;
  }),
  list: publicProcedure.project.list.handler(async () => {
    return listProjects();
  }),
  create: publicProcedure.project.create.handler(async ({ input, errors }) => {
    const result = await createProject(input);
    if (!result.ok) {
      throw errors.CONFLICT();
    }
    return result.project;
  }),
  proxyRoute: {
    list: publicProcedure.project.proxyRoute.list.handler(async ({ input, errors }) => {
      const result = await listProjectProxyRoutes(input);
      if (!result.ok) {
        throw errors.NOT_FOUND();
      }
      return result.routes;
    }),
  },
  database: {
    createPostgres: publicProcedure.project.database.createPostgres.handler(
      async ({ input, errors }) => {
        const result = await createPostgresResource(input);
        if (!result.ok) {
          if (result.reason === "project_not_found") {
            throw errors.NOT_FOUND();
          }
          throw errors.CONFLICT();
        }
        return result.resource;
      },
    ),
    listPostgres: publicProcedure.project.database.listPostgres.handler(
      async ({ input, errors }) => {
        const result = await listPostgresResources(input);
        if (!result.ok) {
          throw errors.NOT_FOUND();
        }
        return result.resources;
      },
    ),
    getPostgres: publicProcedure.project.database.getPostgres.handler(async ({ input, errors }) => {
      const result = await getPostgresResource(input);
      if (!result.ok) {
        throw errors.NOT_FOUND();
      }
      return result.resource;
    }),
  },
};
