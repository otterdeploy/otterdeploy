/**
 * Handler input types: kept separate from `handlers.ts` to keep the
 * orchestration file readable.
 *
 * The wire shape is the single source of truth: `Create*`/`Update*` are
 * `z.infer` of the contract schemas, so they can't drift from what oRPC
 * actually validates (and the branded id fields survive, since the
 * contract uses `zId`, not a plain `z.string()`). Handlers layer two
 * things on top of the wire shape via intersection:
 *   1. `organizationId`, injected server-side from the request context,
 *      so it's never part of the public input.
 *   2. internal-caller-only fields (set by the manifest reconciler, not
 *      exposed on the HTTP contract): `skipBuildBindingCheck`, the extra
 *      `restart`/`resources` knobs, `preDeploy`, `buildConfig`, and the git
 *      binding (`gitRepoId`/`branch`/`sourceSubdir`/`imageRepository`).
 */

import type { BuildConfig } from "@otterdeploy/shared/build-config";
import type {
  EnvironmentId,
  GitRepoId,
  OrganizationId,
  ProjectId,
  ResourceId,
  ServerId,
} from "@otterdeploy/shared/id";
import type * as z from "zod";

import type { createServiceInput, updateServiceInput } from "./contract-inputs";

import { PLATFORM } from "../../constants";
import { sanitizeSlug } from "./views";

type OrgId = OrganizationId;

// Supersets of the wire `restart`/`resources` objects: the manifest
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

/** Project-scoped addressing. Used by `listServices`. */
export interface ProjectRef {
  projectId: ProjectId;
  organizationId: OrgId;
}

export interface CreateServiceInput extends Omit<
  z.infer<typeof createServiceInput>,
  "restart" | "resources"
> {
  organizationId: OrgId;
  /** Environment this service is created in. Omitted means the project's main
   *  environment: names only collide within one environment. */
  environmentId?: EnvironmentId;
  /**
   * Skip the up-front git build-binding gate (gitRepoId / containerRegistryId
   * / imageRepository). The manifest reconciler sets this: a git service
   * should still be CREATED (as a `pending:initial` row that skips swarm) on
   * a project that hasn't bound its registry yet. The missing binding is
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
  /** Root directory in the repo the builder builds from. Internal-caller-only
   *  like the rest of the git binding: the Source card edits it by staging a
   *  manifest, and the reconciler brings it here. */
  sourceSubdir?: string | null;
  imageRepository?: string | null;
  previewsEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Adapters: translate handler inputs into the loose payload shapes that
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
    /** Already narrowed to a server in this org (lib/placement-seed.ts), so
     *  the payload carries the brand rather than re-checking it downstream. */
    placementServerId: ServerId | null;
  },
) {
  return {
    projectId: input.projectId,
    environmentId: input.environmentId ?? null,
    name: input.name,
    status: "draft" as const,
    placementServerId: extras.placementServerId,
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
    // The column is NOT NULL DEFAULT []: an explicit null on the wire means
    // "clear", which lands as the empty list rather than a null column.
    extraNetworks: input.extraNetworks === null ? [] : input.extraNetworks,
    // Per-service git rebinding. undefined → left alone (omitUndefined in
    // updateServiceRecord); an explicit value/null sets or clears the binding.
    gitRepoId: input.gitRepoId,
    branch: input.branch,
    sourceSubdir: input.sourceSubdir,
    imageRepository: input.imageRepository,
    previewsEnabled: input.previewsEnabled,
  };
}

/**
 * Git-sourced services own their own repo: the build worker reads `gitRepoId`
 * off the service row. Only the repo gates creation (registry + image are
 * optional; the builder falls back to a registry-less local build), so this is
 * the fail-fast the UI turns into "pick a repo".
 *
 * `skipBuildBindingCheck` is the manifest reconciler's: an unbound git service
 * should still land as a `pending:initial` row whose BUILD then fails clearly,
 * rather than failing the whole apply at create.
 *
 * A predicate rather than three inline `&&`s so `createService` stays under
 * the complexity cap; the reason it is three conditions lives here with them.
 */
export function missingGitBuildBinding(
  input: CreateServiceInput,
  source: "image" | "git" | "upload",
): boolean {
  return source === "git" && !input.skipBuildBindingCheck && !input.gitRepoId;
}

/**
 * The three docker-visible names a new service gets, all derived from the same
 * two slugs so they cannot drift: the swarm service name (prefixed, capped at
 * docker's 63 chars), the per-project overlay network, and the DNS alias
 * siblings reach it on.
 *
 * Lives here rather than inline in `createService` so that function stays
 * under the line cap, and so the 63-char truncation has one home.
 */
export function deriveServiceNames(
  projectSlugRaw: string,
  name: string,
): {
  projectSlug: string;
  serviceName: string;
  networkName: string;
  internalHostname: string;
} {
  const projectSlug = sanitizeSlug(projectSlugRaw);
  const resourceSlug = sanitizeSlug(name);
  return {
    projectSlug,
    serviceName: `${PLATFORM.service.serviceNamePrefix}${projectSlug}-${resourceSlug}`.slice(0, 63),
    networkName: `${PLATFORM.swarm.networkPrefix}${projectSlug}`,
    internalHostname: resourceSlug,
  };
}
