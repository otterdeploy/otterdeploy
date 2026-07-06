export {
  checkBranchHeadroom,
  getBranchPoolHealth,
  growBranchPool,
  trimBranchPool,
  type BranchPoolHealth,
  type GrowResult,
} from "./branch-pool";
export {
  getHostHealth,
  type DockerUsage,
  type HealthRecommendation,
  type HostHealth,
  type ReclaimTarget,
} from "./host-health";
export { startHostHealthMonitor } from "./monitor";
export { reclaimSpace, type ReclaimResult } from "./reclaim";
export { deriveRecommendations } from "./recommendations";
