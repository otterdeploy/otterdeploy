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

import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import type { BuildConfig } from "@otterdeploy/shared/build-config";
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

export interface CreateServiceInput
  extends Omit<z.infer<typeof createServiceInput>, "restart" | "resources"> {
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
}

export interface UpdateServiceInput
  extends Omit<z.infer<typeof updateServiceInput>, "restart" | "resources"> {
  organizationId: OrgId;
  restart?: RestartInput;
  resources?: ResourcesInput;
  preDeploy?: string[] | null;
  postDeploy?: string[] | null;
  buildConfig?: BuildConfigInput | null;
}

// ---------------------------------------------------------------------------
// Adapters — translate handler inputs into the loose payload shapes that
// the queries module expects. Keeps the `null`/`undefined` choreography
// (used for "explicit clear" vs "leave alone") out of the orchestration.
// ---------------------------------------------------------------------------

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
    image: input.image,
    command: input.command ?? null,
    entrypoint: input.entrypoint ?? null,
    replicas: input.replicas ?? 1,
    restartCondition: input.restart?.condition,
    restartMaxAttempts: input.restart?.maxAttempts ?? null,
    restartDelayMs: input.restart?.delayMs,
    restartWindowMs: input.restart?.windowMs ?? null,
    healthcheckCmd: input.healthcheck?.cmd ?? null,
    healthcheckIntervalMs: input.healthcheck?.intervalMs ?? null,
    healthcheckTimeoutMs: input.healthcheck?.timeoutMs ?? null,
    healthcheckRetries: input.healthcheck?.retries ?? null,
    healthcheckStartMs: input.healthcheck?.startMs ?? null,
    cpuLimit:
      input.resources?.cpuLimit != null ? input.resources.cpuLimit.toString() : null,
    memoryLimitMb: input.resources?.memoryLimitMb ?? null,
    cpuReservation:
      input.resources?.cpuReservation != null
        ? input.resources.cpuReservation.toString()
        : null,
    memoryReservationMb: input.resources?.memoryReservationMb ?? null,
    diskLimitMb: input.resources?.diskLimitMb ?? null,
    swapLimitMb: input.resources?.swapLimitMb ?? null,
    pidsLimit: input.resources?.pidsLimit ?? null,
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

/** Map patch input into the partial payload `updateServiceRecord` expects. */
export function toUpdateRecordPatch(input: UpdateServiceInput) {
  return {
    image: input.image,
    command: input.command,
    entrypoint: input.entrypoint,
    replicas: input.replicas,
    restartCondition: input.restart?.condition,
    restartMaxAttempts: input.restart?.maxAttempts,
    restartDelayMs: input.restart?.delayMs,
    restartWindowMs: input.restart?.windowMs,
    healthcheckCmd: input.healthcheck?.cmd,
    healthcheckIntervalMs: input.healthcheck?.intervalMs,
    healthcheckTimeoutMs: input.healthcheck?.timeoutMs,
    healthcheckRetries: input.healthcheck?.retries,
    healthcheckStartMs: input.healthcheck?.startMs,
    cpuLimit:
      input.resources?.cpuLimit != null ? input.resources.cpuLimit.toString() : undefined,
    memoryLimitMb: input.resources?.memoryLimitMb,
    cpuReservation:
      input.resources?.cpuReservation != null
        ? input.resources.cpuReservation.toString()
        : undefined,
    memoryReservationMb: input.resources?.memoryReservationMb,
    diskLimitMb: input.resources?.diskLimitMb,
    swapLimitMb: input.resources?.swapLimitMb,
    pidsLimit: input.resources?.pidsLimit,
    preDeploy: input.preDeploy,
    postDeploy: input.postDeploy,
    buildConfig: input.buildConfig,
  };
}
