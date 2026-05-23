/**
 * Barrel re-export for the project-router query layer.
 *
 * Implementation is split across files in this folder:
 *   - project.ts:           project + environment CRUD
 *   - postgres-resource.ts: database_resource (postgres) CRUD
 */

export {
  createProjectRecord,
  getProjectById,
  getProjectBySlug,
  getProjectInOrg,
  getProjectRecord,
  listProjectRecordsByOrg,
} from "./project";

export {
  createDatabaseResourceRecord,
  getDatabaseResourceByProjectAndName,
  getDatabaseResourceRecord,
  listDatabaseResourceRecords,
  updateDatabaseResourceRuntime,
  updateDatabaseResourceStatus,
  type DatabaseResourceRecord,
} from "./postgres-resource";
