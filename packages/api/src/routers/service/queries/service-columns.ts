/**
 * The `createServiceRecord` input shape + its `serviceResource` column-group
 * mappers. Split out of service.ts so the insert transaction stays under the
 * complexity/line caps — each group folds the `?? default` choreography away
 * from the orchestration.
 */
import type { BuildConfig } from "@otterdeploy/shared/build-config";
import type { GitRepoId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

export interface CreateServiceInput {
  projectId: ProjectId;
  name: string;
  status?: "draft" | "valid" | "invalid";

  image: string;
  /** "image" = pull a pre-built tag; "git"/"upload" = built by apps/builder
   *  (git clone vs. an uploaded source tarball). */
  source?: "image" | "git" | "upload";
  /** When source = "git", path within the repo handed to nixpacks. */
  sourceSubdir?: string | null;
  /** Per-service git binding (git source only). Repo + branch this service
   *  builds from — its own, not the project's. Resolved from the manifest's
   *  portable `owner/repo` upstream. Null when unbound. */
  gitRepoId?: GitRepoId | null;
  branch?: string | null;
  /** Fully-qualified image target (no tag); null = registry-less local build. */
  imageRepository?: string | null;
  /** Per-service PR-preview opt-in. Defaults off. */
  previewsEnabled?: boolean;
  command?: string[] | null;
  entrypoint?: string[] | null;
  replicas?: number;

  restartCondition?: "none" | "on-failure" | "any";
  restartMaxAttempts?: number | null;
  restartDelayMs?: number;
  restartWindowMs?: number | null;

  healthcheckCmd?: string[] | null;
  healthcheckIntervalMs?: number | null;
  healthcheckTimeoutMs?: number | null;
  healthcheckRetries?: number | null;
  healthcheckStartMs?: number | null;

  cpuLimit?: string | null;
  memoryLimitMb?: number | null;
  cpuReservation?: string | null;
  memoryReservationMb?: number | null;
  diskLimitMb?: number | null;
  swapLimitMb?: number | null;
  pidsLimit?: number | null;

  preDeploy?: string[] | null;
  postDeploy?: string[] | null;
  buildConfig?: BuildConfig | null;

  internalHostname: string;
  serviceName: string;
  networkName: string;

  /** Owning compose stack (the compose resource id). Null/omitted for a
   *  standalone service. Set when this service is materialized from a stack. */
  stackId?: ResourceId | null;

  ports: Array<{
    containerPort: number;
    protocol?: "tcp" | "udp";
    appProtocol?: "http" | "tcp";
    isPrimary?: boolean;
  }>;

  env?: Array<{ key: string; value: string }>;
}

export function serviceCoreColumns(input: CreateServiceInput) {
  return {
    source: input.source ?? "image",
    sourceSubdir: input.sourceSubdir ?? null,
    gitRepoId: input.gitRepoId ?? null,
    branch: input.branch ?? null,
    imageRepository: input.imageRepository ?? null,
    previewsEnabled: input.previewsEnabled ?? false,
    command: input.command ?? null,
    entrypoint: input.entrypoint ?? null,
    replicas: input.replicas ?? 1,
  };
}

export function serviceRestartColumns(input: CreateServiceInput) {
  return {
    restartCondition: input.restartCondition ?? "on-failure",
    restartMaxAttempts: input.restartMaxAttempts ?? null,
    restartDelayMs: input.restartDelayMs ?? 5000,
    restartWindowMs: input.restartWindowMs ?? null,
  };
}

export function serviceHealthcheckColumns(input: CreateServiceInput) {
  return {
    healthcheckCmd: input.healthcheckCmd ?? null,
    healthcheckIntervalMs: input.healthcheckIntervalMs ?? null,
    healthcheckTimeoutMs: input.healthcheckTimeoutMs ?? null,
    healthcheckRetries: input.healthcheckRetries ?? null,
    healthcheckStartMs: input.healthcheckStartMs ?? null,
  };
}

export function serviceResourceColumns(input: CreateServiceInput) {
  return {
    cpuLimit: input.cpuLimit ?? null,
    memoryLimitMb: input.memoryLimitMb ?? null,
    cpuReservation: input.cpuReservation ?? null,
    memoryReservationMb: input.memoryReservationMb ?? null,
    diskLimitMb: input.diskLimitMb ?? null,
    swapLimitMb: input.swapLimitMb ?? null,
    pidsLimit: input.pidsLimit ?? null,
  };
}

export function serviceDeployColumns(input: CreateServiceInput) {
  return {
    preDeploy: input.preDeploy ?? null,
    postDeploy: input.postDeploy ?? null,
    buildConfig: input.buildConfig ?? null,
    stackId: input.stackId ?? null,
  };
}
