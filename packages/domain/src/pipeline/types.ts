import type { Result } from "better-result";
import type {
  ResourceSelect,
  ResourceRuntimeConfigSelect,
  ResourceBuildConfigSelect,
  DeploymentSelect,
  ProjectSelect,
  EnvironmentSelect,
  GitRepositorySelect,
} from "@otterdeploy/db/zod";

/**
 * Shared types for deployment pipeline steps.
 * Types are inferred from Drizzle schema via drizzle-zod — enum fields
 * narrow to actual unions (e.g. kind → "web"|"api"|"worker"|"database"|"compose").
 */

export type DeploymentContext = {
  deploymentId: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  resourceId: string;
  actorUserId: string;
  source: DeploymentSelect["source"];
  correlationId?: string;
};

export type ResourceConfig = Pick<ResourceSelect, "id" | "name" | "kind" | "serverId"> &
  Pick<
    ResourceRuntimeConfigSelect,
    | "port"
    | "healthCheckPath"
    | "healthCheckInterval"
    | "healthCheckTimeout"
    | "replicas"
    | "cpuLimit"
    | "memoryLimit"
    | "startCommand"
    | "restartPolicy"
    | "restartPolicyMaxRetries"
  > &
  Pick<ResourceBuildConfigSelect, "preDeployCommand" | "builder" | "dockerfilePath" | "buildCommand">;

export type ProjectConfig = Pick<
  ProjectSelect,
  "id" | "name" | "slug" | "baseDomain" | "organizationId"
>;

export type EnvironmentConfig = Pick<EnvironmentSelect, "id" | "name" | "slug" | "projectId">;

export type GitRepoConfig = Pick<
  GitRepositorySelect,
  "owner" | "name" | "branch" | "rootDirectory" | "gitProviderId"
> & {
  accessToken?: string;
};

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
  logs: string[];
}

export interface CloneResult {
  sourceDir: string;
  skipped: boolean;
}

/** Return type for PipelineDeps.getDeployment */
export type DeploymentRecord = Pick<
  DeploymentSelect,
  | "id"
  | "organizationId"
  | "projectId"
  | "environmentId"
  | "resourceId"
  | "status"
  | "source"
  | "builder"
  | "imageTag"
  | "previousImageTag"
  | "gitRef"
  | "gitCommitSha"
  | "triggeredBy"
>;

/**
 * Dependencies that pipeline steps inject for DB access and external calls.
 * This makes the pipeline testable without real DB or Docker.
 */
export interface PipelineDeps {
  // DB queries
  getDeployment: (id: string) => Promise<DeploymentRecord | null>;

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
