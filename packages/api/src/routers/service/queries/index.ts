/**
 * Barrel re-export for the service-router query layer.
 *
 * Implementation is split across files in this folder to keep each module
 * under the project's 350-line cap:
 *   - service.ts: service_resource CRUD + helpers
 *   - ports.ts:   service_port CRUD
 *   - env.ts:     service_env_var CRUD + cross-resource ref lookups
 */

import type {
  resource,
  serviceEnvVar,
  serviceMount,
  servicePort,
  serviceResource,
} from "@otterstack/db/schema/project";

export type ResourceRow = typeof resource.$inferSelect;
export type ServiceResourceRow = typeof serviceResource.$inferSelect;
export type ServicePortRow = typeof servicePort.$inferSelect;
export type ServiceEnvVarRow = typeof serviceEnvVar.$inferSelect;
export type ServiceMountRow = typeof serviceMount.$inferSelect;

export interface ServiceRecord {
  resource: ResourceRow;
  service: ServiceResourceRow;
  ports: ServicePortRow[];
  env: ServiceEnvVarRow[];
  mounts: ServiceMountRow[];
}

export {
  createServiceRecord,
  deleteServiceRecord,
  getServiceRecord,
  getServiceRecordByName,
  listServiceRecordsByProject,
  setPublicExposure,
  bumpForceUpdateCounter,
  updateServiceRecord,
  updateServiceResourceStatus,
  type CreateServiceInput,
  type UpdateServiceInput,
} from "./service";

export {
  getPrimaryHttpPort,
  listServicePorts,
  replaceServicePorts,
} from "./ports";

export {
  bulkReplaceServiceEnvVars,
  deleteServiceEnvVar,
  findServiceDependentsByName,
  getResourceByProjectAndName,
  listServiceEnvVars,
  upsertServiceEnvVar,
} from "./env";

export {
  bulkReplaceServiceMounts,
  deleteServiceMount,
  listServiceMounts,
  upsertServiceMount,
} from "./mounts";
