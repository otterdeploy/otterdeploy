export { validateDeployment } from "./validate";
export { cloneSource } from "./clone";
export { resolveSecrets } from "./resolve-secrets";
export { buildImage } from "./build";
export { runPreDeployCommand } from "./pre-deploy";
export { deploySwarmService } from "./deploy";
export { waitForHealthy } from "./health-check";
export { routeTraffic } from "./route-traffic";
export { verifyDeployment } from "./verify";
export { cleanupBuild } from "./cleanup";

export type {
  DeploymentContext,
  ResourceConfig,
  ProjectConfig,
  EnvironmentConfig,
  GitRepoConfig,
  ValidateOutput,
  ResolvedEnvVars,
  BuildResult,
  CloneResult,
  DeploymentRecord,
  PipelineDeps,
} from "./types";

export type { CloneSourceDeps } from "./clone";
export type { ResolveSecretsDeps } from "./resolve-secrets";
export type { BuildDeps } from "./build";
export type { PreDeployDeps } from "./pre-deploy";
export type { DeployDeps } from "./deploy";
export type { HealthCheckDeps } from "./health-check";
export type { RouteTrafficDeps } from "./route-traffic";
export type { VerifyDeps } from "./verify";
export type { CleanupDeps } from "./cleanup";
