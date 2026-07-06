/**
 * Handler input types — kept separate from `handlers.ts` to keep the
 * orchestration file readable.
 *
 * The wire shape is the single source of truth: `Create*`/`Update*` are
 * `z.infer` of the contract schemas, so they can't drift from what oRPC
 * actually validates (and the branded id fields survive, since the
 * contract uses `zId`, not a plain `z.string()`). Handlers layer two
 * things on top of the wire shape via intersection:
 *   1. `organizationId` — injected server-side from the request context,
 *      so it's never part of the public input.
 *   2. internal-caller-only fields (set by the manifest reconciler, not
 *      exposed on the HTTP contract): `skipBuildBindingCheck`, the extra
 *      `restart`/`resources` knobs, `preDeploy`, `buildConfig`.
 */

import type { BuildConfig } from "@otterdeploy/shared/build-config";
import type { GitRepoId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type * as z from "zod";

import type { createServiceInput, updateServiceInput } from "./contract";

type OrgId = OrganizationId;

// Supersets of the wire `restart`/`resources` objects — the manifest
// reconciler sets fields (window, disk/swap/pids) that the public contract
// doesn't yet expose but the record adapters below still read.
interface RestartInput {
  condition?: "none" | "on-failure" | "any";
  maxAttempts?: number | null;
  delayMs?: number;
  windowMs?: number | null;
}

interface ResourcesInput {
  cpuLimit?: number | null;
  memoryLimitMb?: number | null;
  cpuReservation?: number | null;
  memoryReservationMb?: number | null;
  diskLimitMb?: number | null;
  swapLimitMb?: number | null;
  pidsLimit?: number | null;
}

// Re-export so callers can `import { BuildConfigInput }` from the
// service router without reaching across packages. Same shape as the
// shared `BuildConfig` discriminated union.
export type BuildConfigInput = BuildConfig;

/** Common (projectId, resourceId) addressing tuple used by most handlers. */
export interface ResourceRef {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
}

/** Project-scoped addressing — used by `listServices`. */
export interface ProjectRef {
  projectId: ProjectId;
  organizationId: OrgId;
}

export interface CreateServiceInput extends Omit<
  z.infer<typeof createServiceInput>,
  "restart" | "resources"
> {
  organizationId: OrgId;
  /**
   * Skip the up-front git build-binding gate (gitRepoId / containerRegistryId
   * / imageRepository). The manifest reconciler sets this: a git service
   * should still be CREATED (as a `pending:initial` row that skips swarm) on
   * a project that hasn't bound its registry yet — the missing binding is
   * reported later as a non-fatal "build not started" skip, not a hard
   * create failure. The direct `service.create` endpoint leaves this unset
   * so it keeps failing fast with MISSING_BUILD_BINDING.
   */
  skipBuildBindingCheck?: boolean;
  restart?: RestartInput;
  resources?: ResourcesInput;
  preDeploy?: string[] | null;
  postDeploy?: string[] | null;
  buildConfig?: BuildConfigInput | null;
  // Per-service git binding (git source only), set by the manifest reconciler
  // after resolving the manifest's portable `owner/repo` to a git_repo row.
  gitRepoId?: GitRepoId | null;
  branch?: string | null;
  imageRepository?: string | null;
  previewsEnabled?: boolean;
}

export interface UpdateServiceInput extends Omit<
  z.infer<typeof updateServiceInput>,
  "restart" | "resources"
> {
  organizationId: OrgId;
  restart?: RestartInput;
  resources?: ResourcesInput;
  preDeploy?: string[] | null;
  postDeploy?: string[] | null;
  buildConfig?: BuildConfigInput | null;
  gitRepoId?: GitRepoId | null;
  branch?: string | null;
  imageRepository?: string | null;
  previewsEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Adapters — translate handler inputs into the loose payload shapes that
// the queries module expects. Keeps the `null`/`undefined` choreography
// (used for "explicit clear" vs "leave alone") out of the orchestration.
//
// Each adapter is split into cohesive column groups (restart / healthcheck /
// resources) so the wide field mapping stays under the complexity cap. Create
// fills absent values with `null` (seed defaults); update leaves them
// `undefined` (omitundefined-stripped → "leave the column alone").
// ---------------------------------------------------------------------------

function toRestartCreateColumns(restart: RestartInput | undefined) {
  return {
    restartCondition: restart?.condition,
    restartMaxAttempts: restart?.maxAttempts ?? null,
    restartDelayMs: restart?.delayMs,
    restartWindowMs: restart?.windowMs ?? null,
  };
}

function toHealthcheckCreateColumns(healthcheck: CreateServiceInput["healthcheck"]) {
  return {
    healthcheckCmd: healthcheck?.cmd ?? null,
    healthcheckIntervalMs: healthcheck?.intervalMs ?? null,
    healthcheckTimeoutMs: healthcheck?.timeoutMs ?? null,
    healthcheckRetries: healthcheck?.retries ?? null,
    healthcheckStartMs: healthcheck?.startMs ?? null,
  };
}

function toResourceCreateColumns(resources: ResourcesInput | undefined) {
  const r: ResourcesInput = resources ?? {};
  return {
    cpuLimit: r.cpuLimit != null ? r.cpuLimit.toString() : null,
    memoryLimitMb: r.memoryLimitMb ?? null,
    cpuReservation: r.cpuReservation != null ? r.cpuReservation.toString() : null,
    memoryReservationMb: r.memoryReservationMb ?? null,
    diskLimitMb: r.diskLimitMb ?? null,
    swapLimitMb: r.swapLimitMb ?? null,
    pidsLimit: r.pidsLimit ?? null,
  };
}

/** Map create-time input into the wide payload `createServiceRecord` expects. */
export function toCreateRecordPayload(
  input: CreateServiceInput,
  extras: {
    ports: Array<{
      containerPort: number;
      protocol: "tcp" | "udp";
      appProtocol: "http" | "tcp";
      isPrimary: boolean;
    }>;
    serviceName: string;
    networkName: string;
    internalHostname: string;
  },
) {
  return {
    projectId: input.projectId,
    name: input.name,
    status: "draft" as const,
    source: input.source ?? "image",
    sourceSubdir: input.sourceSubdir ?? null,
    gitRepoId: input.gitRepoId ?? null,
    branch: input.branch ?? null,
    imageRepository: input.imageRepository ?? null,
    previewsEnabled: input.previewsEnabled ?? false,
    image: input.image,
    command: input.command ?? null,
    entrypoint: input.entrypoint ?? null,
    replicas: input.replicas ?? 1,
    ...toRestartCreateColumns(input.restart),
    ...toHealthcheckCreateColumns(input.healthcheck),
    ...toResourceCreateColumns(input.resources),
    preDeploy: input.preDeploy ?? null,
    postDeploy: input.postDeploy ?? null,
    buildConfig: input.buildConfig ?? null,
    internalHostname: extras.internalHostname,
    serviceName: extras.serviceName,
    networkName: extras.networkName,
    ports: extras.ports,
    env: input.env,
  };
}

function toRestartUpdateColumns(restart: RestartInput | undefined) {
  return {
    restartCondition: restart?.condition,
    restartMaxAttempts: restart?.maxAttempts,
    restartDelayMs: restart?.delayMs,
    restartWindowMs: restart?.windowMs,
  };
}

function toHealthcheckUpdateColumns(healthcheck: UpdateServiceInput["healthcheck"]) {
  return {
    healthcheckCmd: healthcheck?.cmd,
    healthcheckIntervalMs: healthcheck?.intervalMs,
    healthcheckTimeoutMs: healthcheck?.timeoutMs,
    healthcheckRetries: healthcheck?.retries,
    healthcheckStartMs: healthcheck?.startMs,
  };
}

function toResourceUpdateColumns(resources: ResourcesInput | undefined) {
  const r: ResourcesInput = resources ?? {};
  return {
    cpuLimit: r.cpuLimit != null ? r.cpuLimit.toString() : undefined,
    memoryLimitMb: r.memoryLimitMb,
    cpuReservation: r.cpuReservation != null ? r.cpuReservation.toString() : undefined,
    memoryReservationMb: r.memoryReservationMb,
    diskLimitMb: r.diskLimitMb,
    swapLimitMb: r.swapLimitMb,
    pidsLimit: r.pidsLimit,
  };
}

/** Map patch input into the partial payload `updateServiceRecord` expects. */
export function toUpdateRecordPatch(input: UpdateServiceInput) {
  return {
    image: input.image,
    command: input.command,
    entrypoint: input.entrypoint,
    replicas: input.replicas,
    ...toRestartUpdateColumns(input.restart),
    ...toHealthcheckUpdateColumns(input.healthcheck),
    ...toResourceUpdateColumns(input.resources),
    preDeploy: input.preDeploy,
    postDeploy: input.postDeploy,
    buildConfig: input.buildConfig,
    // Per-service git rebinding. undefined → left alone (omitUndefined in
    // updateServiceRecord); an explicit value/null sets or clears the binding.
    gitRepoId: input.gitRepoId,
    branch: input.branch,
    imageRepository: input.imageRepository,
    previewsEnabled: input.previewsEnabled,
  };
}
