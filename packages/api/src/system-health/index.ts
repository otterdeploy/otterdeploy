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
export { agentHealthIngestHandler, HEALTH_SAMPLE_INTERVAL_MS } from "./agent-ingest";
export { agentRegisterHandler } from "./agent-register";
export { startHealthAgentReconciler, startLocalHealthSampler } from "./agent-service";
export {
  issueSessionCredential,
  revokeHealthAgentCredentialsForServer,
  SESSION_TTL_SECONDS,
  verifySessionCredential,
  type VerifiedSession,
} from "./agent-credential";
export { startHostHealthMonitor } from "./monitor";
export {
  recordOrphanedResource,
  startOrphanResourceGc,
  sweepOrphanedResources,
  type OrphanResourceType,
  type RecordOrphanInput,
} from "./orphan-gc";
export { reclaimSpace, type ReclaimResult } from "./reclaim";
export { deriveRecommendations } from "./recommendations";
