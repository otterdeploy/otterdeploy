export { initializeSwarm, ensureSwarm, ensureProjectNetwork, removeProjectNetwork } from "./client";
// New generic database surface — dispatches on engine via the adapter.
// All new code should call provisionSwarmDatabase / updateSwarmDatabase /
// inspectSwarmDatabaseRuntime / destroySwarmDatabase with { engine, ... }.
export {
  provisionSwarmDatabase,
  updateSwarmDatabase,
  inspectSwarmDatabaseRuntime,
  destroySwarmDatabase,
  type SwarmDatabaseRuntime,
  type ProvisionSwarmDatabaseInput,
} from "./database";
export {
  getEngineAdapter,
  defaultImageFor,
  type DatabaseEngineAdapter,
  type ConnectionStringInput,
} from "./database-engines";
// Legacy postgres-specific wrappers — kept as thin delegates so the existing
// postgres-specific call sites compile while they're migrated to the generic
// database surface above. Prefer the generic names in new code.
export {
  provisionSwarmPostgres,
  updateSwarmPostgres,
  inspectSwarmPostgresRuntime,
  destroySwarmPostgres,
  type SwarmPostgresRuntime,
} from "./postgres";
export {
  provisionSwarmService,
  updateSwarmService,
  restartSwarmService,
  destroySwarmService,
  inspectSwarmServiceRuntime,
  type SwarmServiceRuntime,
  type SwarmServiceSpec,
  type SwarmServicePort,
  type SwarmServiceHealthcheck,
  type SwarmServiceResources,
  type SwarmServiceRestart,
} from "./service";
export {
  deployComposeStack,
  removeComposeStack,
  inspectComposeStack,
  type ComposeStackRuntime,
} from "./compose";
export { streamImagePull, type ImagePullEvent, type RegistryAuth } from "./image-pull";
export { createPullLineSummarizer, type PullLineSummarizer } from "./pull-progress";
export { resolveRegistryAuth } from "./registry-auth";
export { materializeServiceMounts, type ServiceMountInput, type SpecMount } from "./file-mounts";
export {
  subscribeDockerEvents,
  subscribeDockerEventsWhere,
  waitForEvent,
  waitForServiceContainerStart,
  waitForServiceCreate,
  type ContainerEvent,
  type DockerEvent,
  type NetworkEvent,
  type NodeEvent,
  type ServiceEvent,
  type TaskEvent,
  type UnknownEvent,
} from "./events";
