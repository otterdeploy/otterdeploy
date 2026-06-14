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
  createPostgresResourceStream,
  restartDatabaseResource,
  setPostgresPublic,
  setPostgresExtensions,
  setPostgresExtraEnvKey,
  unsetPostgresExtraEnvKey,
  validatePostgresCreate,
  type CreatePostgresProgress,
} from "./postgres";

export {
  checkResourceName,
  deleteProjectResource,
  getProjectResource,
  listProjectResources,
  type ProjectResource,
} from "./resources";

export {
  bulkSetResourceEnv,
  listResourceEnv,
  listResourceTasks,
  type EnvEntry,
} from "./resource-runtime";

export {
  tailDeploymentLogs,
  tailResourceLogs,
  tailTaskLogs,
  type ResourceLogEvent,
} from "./resource-logs";

export {
  listResourceDeployments,
  listTasksForDeployment,
  type DeploymentWithStats,
  type DeploymentTaskInfo,
} from "./deployments";

export { listProjectDependencies, type DependencyEdge } from "./dependencies";

export {
  listProjectServiceTasks,
  type ServiceTasks,
  type ServiceTaskInfo,
} from "./service-tasks";

export {
  createDeploymentBypassToken,
  createDeploymentShareLink,
  getProjectCaddyfile,
  getProjectCustomCaddyConfig,
  saveProjectCustomCaddyConfig,
  setProxyRouteDirectives,
  inviteDeploymentGuest,
  listDeploymentGuests,
  listProjectProxyRoutes,
  removeDeploymentGuest,
  setProxyRouteProtection,
} from "./proxy-routes";

export {
  bulkReplaceProjectEnvVarsForOrg,
  deleteProjectEnvVarForOrg,
  listProjectEnvVarsForOrg,
  upsertProjectEnvVarForOrg,
} from "./env-var";

export type {
  PostgresResource,
  Project,
  ProxyRoute,
} from "./views";
