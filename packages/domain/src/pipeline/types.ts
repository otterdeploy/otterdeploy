import type { Result } from "better-result";

/**
 * Shared types for deployment pipeline steps.
 * Each step receives typed input and returns a Result.
 */

export interface DeploymentContext {
  deploymentId: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  resourceId: string;
  actorUserId: string;
  source: "git_push" | "manual" | "rollback" | "api" | "preview" | "config_change";
  correlationId?: string;
}

export interface ResourceConfig {
  id: string;
  name: string;
  kind: string;
  port: number | null;
  healthCheckPath: string | null;
  healthCheckInterval: number | null;
  healthCheckTimeout: number | null;
  replicas: number | null;
  cpuLimit: number | null;
  memoryLimit: number | null;
  startCommand: string | null;
  preDeployCommand: string | null;
  restartPolicy: string | null;
  restartPolicyMaxRetries: number | null;
  builder: string | null;
  dockerfilePath: string | null;
  buildCommand: string | null;
  serverId: string | null;
}

export interface ProjectConfig {
  id: string;
  name: string;
  slug: string;
  baseDomain: string | null;
  organizationId: string | null;
}

export interface EnvironmentConfig {
  id: string;
  name: string;
  projectId: string;
}

export interface GitRepoConfig {
  owner: string;
  name: string;
  branch: string;
  rootDirectory: string | null;
  gitProviderId: string;
  accessToken?: string;
}

export interface ValidateOutput {
  deployment: DeploymentContext;
  resource: ResourceConfig;
  project: ProjectConfig;
  environment: EnvironmentConfig;
  gitRepo: GitRepoConfig | null;
  builder: string;
  imageTag: string | null;
  previousImageTag: string | null;
}

export interface ResolvedEnvVars {
  buildTime: Record<string, string>;
  runtime: Record<string, string>;
  all: Record<string, string>;
  snapshotHash: string;
}

export interface BuildResult {
  imageName: string;
  imageTag: string;
  fullImage: string;
  durationMs: number;
}

export interface CloneResult {
  sourceDir: string;
  skipped: boolean;
}

/**
 * Dependencies that pipeline steps inject for DB access and external calls.
 * This makes the pipeline testable without real DB or Docker.
 */
export interface PipelineDeps {
  // DB queries
  getDeployment: (id: string) => Promise<{
    id: string;
    organizationId: string;
    projectId: string;
    environmentId: string;
    resourceId: string;
    status: string;
    source: string;
    builder: string | null;
    imageTag: string | null;
    previousImageTag: string | null;
    gitRef: string | null;
    gitCommitSha: string | null;
    triggeredBy: string | null;
  } | null>;

  getResource: (id: string) => Promise<ResourceConfig | null>;

  getProject: (id: string) => Promise<ProjectConfig | null>;

  getEnvironment: (id: string) => Promise<EnvironmentConfig | null>;

  getGitRepository: (resourceId: string) => Promise<GitRepoConfig | null>;

  getActiveDeploymentsForResource: (
    resourceId: string,
    excludeDeploymentId: string,
  ) => Promise<Array<{ id: string; status: string }>>;

  getResourceDomains: (
    resourceId: string,
  ) => Promise<Array<{ domain: string; verified: boolean }>>;

  getResourcePort: (resourceId: string) => Promise<number>;

  // Deployment machine transitions
  transitionTo: (
    deploymentId: string,
    status: string,
    eventData: { actor: string; reason?: string; metadata?: Record<string, unknown> },
  ) => Promise<Result<void, Error>>;

  // Update deployment record
  updateDeployment: (
    deploymentId: string,
    data: { imageTag?: string; previousImageTag?: string },
  ) => Promise<void>;
}
