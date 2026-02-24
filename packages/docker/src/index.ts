export { getDockerClient, setDockerClient, resetDockerClient } from "./client";
export { initSwarm, isSwarmActive, createIngressNetwork } from "./swarm";
export {
  createService,
  updateService,
  removeService,
  inspectService,
  listServices,
  getServiceLogs,
  scaleService,
} from "./service";
export {
  pullImage,
  tagImage,
  removeImage,
  pruneImages,
  listImages,
} from "./image";
export {
  createProjectNetwork,
  removeProjectNetwork,
  connectServiceToNetwork,
  disconnectServiceFromNetwork,
} from "./network";
export {
  createVolume,
  removeVolume,
  inspectVolume,
  listVolumes,
} from "./volume";
export {
  listContainers,
  getContainerStats,
  execInContainer,
  lightCleanup,
  aggressiveCleanup,
  getDiskUsage,
} from "./stats";
export {
  createDockerConfig,
  removeDockerConfig,
  listDockerConfigs,
} from "./config";
export {
  stackDeploy,
  stackRemove,
  stackServices,
} from "./stack";
export type {
  OtterStackLabels,
  SwarmInitResult,
  NetworkCreateResult,
  CreateServiceOpts,
  UpdateServiceOpts,
  ServiceLogOpts,
  ServiceInfo,
  ContainerInfo,
  ContainerStats,
  ExecResult,
  DiskUsageInfo,
  VolumeInfo,
  ImageInfo,
  DockerConfigInfo,
} from "./types";
export type { StackServiceInfo } from "./stack";
