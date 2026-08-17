/**
 * View types for the Service primitive plus small string/port helpers
 * shared across the handler split.
 *
 * `mapServiceView` hydrates a `ServiceRecord` into the wire-shape consumed
 * by the oRPC contract; `mapEnvVar` does the same for env-var rows.
 */

import { runtime as activeRuntime } from "../../runtime";
import { type SwarmServiceRuntime } from "../../swarm";
import { type ServiceRecord } from "./queries";

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

export interface ServiceView {
  id: string;
  projectId: string;
  name: string;
  status: "draft" | "valid" | "invalid";

  image: string;
  imageDigest: string | null;
  command: string[] | null;
  entrypoint: string[] | null;
  replicas: number;
  /** Non-null = paused; the replica count `service.resume` restores. */
  pausedReplicas: number | null;
  /** Server this service is pinned to, or null when the scheduler places it.
   *  Pinned means no failover. The UI has to say so wherever it's shown. */
  placementServerId: string | null;

  restart: {
    condition: "none" | "on-failure" | "any";
    maxAttempts: number | null;
    delayMs: number;
  };

  healthcheck: {
    cmd: string[] | null;
    intervalMs: number | null;
    timeoutMs: number | null;
    retries: number | null;
    startMs: number | null;
  } | null;

  resources: {
    cpuLimit: number | null;
    memoryLimitMb: number | null;
    cpuReservation: number | null;
    memoryReservationMb: number | null;
  };

  ports: Array<{
    id: string;
    containerPort: number;
    protocol: "tcp" | "udp";
    appProtocol: "http" | "tcp";
    isPrimary: boolean;
  }>;

  publicEnabled: boolean;
  publicDomain: string | null;
  internalHostname: string;
  /** Extra docker networks (names) joined in addition to the project network. */
  extraNetworks: string[];

  runtime: SwarmServiceRuntime;

  createdAt: string;
  updatedAt: string;
}

export interface EnvVarView {
  id: string;
  serviceResourceId: string;
  key: string;
  /** Empty string when `sealed`: see `mapEnvVar`. */
  value: string;
  sealed: boolean;
}

// ---------------------------------------------------------------------------
// Port input normalization
// ---------------------------------------------------------------------------

export interface PortInput {
  containerPort: number;
  protocol?: "tcp" | "udp";
  appProtocol?: "http" | "tcp";
  isPrimary?: boolean;
}

/**
 * Ensure exactly one primary HTTP port. If the user didn't flag one,
 * promote the first HTTP port. No-op if there are no HTTP ports.
 */
export function normalizePorts(ports: PortInput[]) {
  const hasHttp = ports.some((p) => (p.appProtocol ?? "http") === "http");
  const hasPrimary = ports.some((p) => p.isPrimary === true);
  let promotedPrimary = false;
  return ports.map((p) => {
    const appProtocol = p.appProtocol ?? "http";
    const isPrimary =
      p.isPrimary === true ||
      (hasHttp && !hasPrimary && !promotedPrimary && appProtocol === "http"
        ? ((promotedPrimary = true), true)
        : false);
    return {
      containerPort: p.containerPort,
      protocol: p.protocol ?? "tcp",
      appProtocol,
      isPrimary,
    };
  });
}

// ---------------------------------------------------------------------------
// View mappers
// ---------------------------------------------------------------------------

export async function mapServiceView(
  record: ServiceRecord,
  projectSlug: string,
  runtime?: SwarmServiceRuntime,
): Promise<ServiceView> {
  const live =
    runtime ??
    (await activeRuntime().inspect({
      serviceName: record.service.serviceName,
      projectSlug: sanitizeSlug(projectSlug),
    }));

  return {
    id: record.resource.id,
    projectId: record.resource.projectId,
    name: record.resource.name,
    status: record.resource.status,
    image: record.service.image,
    imageDigest: record.service.imageDigest,
    command: record.service.command,
    entrypoint: record.service.entrypoint,
    replicas: record.service.replicas,
    pausedReplicas: record.service.pausedReplicas,
    placementServerId: record.resource.placementServerId ?? null,
    restart: {
      condition: record.service.restartCondition,
      maxAttempts: record.service.restartMaxAttempts,
      delayMs: record.service.restartDelayMs,
    },
    healthcheck: record.service.healthcheckCmd
      ? {
          cmd: record.service.healthcheckCmd,
          intervalMs: record.service.healthcheckIntervalMs,
          timeoutMs: record.service.healthcheckTimeoutMs,
          retries: record.service.healthcheckRetries,
          startMs: record.service.healthcheckStartMs,
        }
      : null,
    resources: {
      cpuLimit: record.service.cpuLimit != null ? Number(record.service.cpuLimit) : null,
      memoryLimitMb: record.service.memoryLimitMb,
      cpuReservation:
        record.service.cpuReservation != null ? Number(record.service.cpuReservation) : null,
      memoryReservationMb: record.service.memoryReservationMb,
    },
    ports: record.ports.map((p) => ({
      id: p.id,
      containerPort: p.containerPort,
      protocol: p.protocol,
      appProtocol: p.appProtocol,
      isPrimary: p.isPrimary,
    })),
    publicEnabled: record.service.publicEnabled,
    publicDomain: record.service.publicDomain,
    internalHostname: record.service.internalHostname,
    extraNetworks: record.service.extraNetworks,
    runtime: live,
    createdAt: record.resource.createdAt.toISOString(),
    updatedAt: record.resource.updatedAt.toISOString(),
  };
}

/**
 * Sealed rows are write-only: the value is masked here, at the single mapper
 * every read path funnels through, rather than at each call site, so a new
 * endpoint cannot forget to mask. Masking is unconditional on `sealed` and
 * never inspects the stored value, so a row that somehow holds plaintext
 * still cannot be read back.
 */
export function mapEnvVar(row: {
  id: string;
  serviceResourceId: string;
  key: string;
  value: string;
  sealed?: boolean;
}): EnvVarView {
  const sealed = row.sealed ?? false;
  return {
    id: row.id,
    serviceResourceId: row.serviceResourceId,
    key: row.key,
    value: sealed ? "" : row.value,
    sealed,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function sanitizeSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 32) : "x";
}

/**
 * Re-exported from the leaf ../project/view-helpers rather than reimplemented.
 *
 * This module used to carry its own copy that checked only the TOP-LEVEL
 * `error.code`. Drizzle wraps the driver error, so the Postgres `23505` sits on
 * `.cause`: the copy therefore missed every real collision and misclassified
 * it as an unexpected failure. One implementation, one behaviour.
 */
export { isUniqueViolation } from "../project/view-helpers";
