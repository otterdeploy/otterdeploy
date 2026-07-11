/**
 * Barrel re-export for the project-router query layer.
 *
 * Implementation is split across files in this folder:
 *   - project.ts:                    project + environment CRUD
 *   - postgres-resource.ts:          database_resource (postgres) CRUD
 *   - postgres-draft-credentials.ts: staged-database draft credentials
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
  getDatabaseResourceByProjectAndName,
  getDatabaseResourceRecord,
  listDatabaseResourceRecords,
  setDatabaseResourceExtensions,
  setDatabaseResourceExtraEnv,
  setDatabaseResourcePreviewBranching,
  setDatabaseResourcePublic,
  updateDatabaseResourceRuntime,
  updateDatabaseResourceStatus,
  type DatabaseResourceRecord,
} from "./postgres-resource";

export {
  deleteDraftCredential,
  deleteDraftCredentialsNotIn,
  ensureDraftCredentialPassword,
  getDraftCredentialPassword,
} from "./postgres-draft-credentials";

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

export {
  getPreviewById,
  listActivePreviewsByProject,
  markPreviewClosedById,
  setPreviewAutoTeardown,
  setPreviewPaused,
  type PreviewRow,
} from "./preview";
