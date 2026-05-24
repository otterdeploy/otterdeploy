/**
 * Public orchestration surface for the Project primitive. The handlers are
 * grouped by concern across three modules (project CRUD, Postgres database
 * resources, proxy routes) and re-exported here so the oRPC router has a
 * single import target — mirroring the service module's layout.
 */

export {
  createProject,
  deleteProject,
  getProject,
  getProjectBySlugForOrg,
  listProjects,
  updateProject,
} from "./projects";

export {
  createPostgresResource,
  deletePostgresResource,
  getPostgresResource,
  listPostgresResources,
} from "./postgres";

export { listProjectProxyRoutes } from "./proxy-routes";

export type {
  PostgresResource,
  Project,
  ProxyRoute,
} from "./views";
