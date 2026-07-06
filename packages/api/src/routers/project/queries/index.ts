/**
 * Barrel re-export for the project-router query layer.
 *
 * Implementation is split across files in this folder:
 *   - project.ts:           project + environment CRUD
 *   - postgres-resource.ts: database_resource (postgres) CRUD
 */

export {
  createProjectRecord,
  deleteProjectRecord,
  getEnvironmentById,
  getProjectById,
  getProjectBySlugInOrg,
  getProjectInOrg,
  getProjectRecord,
  getRouteInOrg,
  listProjectRecordsByOrg,
  listServiceResourceRefsByOrg,
  loadProjectEnvBag,
  setProjectGraphLayout,
  updateProjectRecord,
} from "./project";

export {
  createDatabaseResourceRecord,
  deleteDraftCredential,
  deleteDraftCredentialsNotIn,
  ensureDraftCredentialPassword,
  getDatabaseResourceByProjectAndName,
  getDatabaseResourceRecord,
  getDraftCredentialPassword,
  listDatabaseResourceRecords,
  setDatabaseResourceExtensions,
  setDatabaseResourceExtraEnv,
  setDatabaseResourcePublic,
  updateDatabaseResourceRuntime,
  updateDatabaseResourceStatus,
  type DatabaseResourceRecord,
} from "./postgres-resource";

export {
  deleteResourceById,
  getResourceById,
  listProjectResources,
  type ComposeResourceJoined,
  type DatabaseResourceJoined,
  type ServiceResourceJoined,
} from "./resource";

export {
  bulkReplaceProjectEnvVars,
  deleteProjectEnvVar,
  listProjectEnvVars,
  upsertProjectEnvVar,
  type ProjectEnvVarRow,
} from "./project-env";
