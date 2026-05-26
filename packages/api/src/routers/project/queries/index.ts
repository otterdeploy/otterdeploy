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
  getProjectById,
  getProjectBySlug,
  getProjectBySlugInOrg,
  getProjectInOrg,
  getProjectRecord,
  listProjectRecordsByOrg,
  loadProjectEnvBag,
  updateProjectRecord,
} from "./project";

export {
  createDatabaseResourceRecord,
  getDatabaseResourceByProjectAndName,
  getDatabaseResourceRecord,
  listDatabaseResourceRecords,
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
  type DatabaseResourceJoined,
  type ServiceResourceJoined,
} from "./resource";
