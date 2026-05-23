/**
 * View types for the Service primitive plus small string/port helpers
 * shared across the handler split.
 *
 * `mapServiceView` hydrates a `ServiceRecord` into the wire-shape consumed
 * by the oRPC contract; `mapEnvVar` does the same for env-var rows.
 */

import {
  inspectSwarmServiceRuntime,
  type SwarmServiceRuntime,
} from "../../swarm";
import { type ServiceRecord } from "./queries";

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

export type ServiceView = {
  id: string;
  projectId: string;
  name: string;
  status: "draft" | "valid" | "invalid";

  image: string;
  imageDigest: string | null;
  command: string[] | null;
  entrypoint: string[] | null;
  replicas: number;

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

  runtime: SwarmServiceRuntime;

  createdAt: string;
  updatedAt: string;
};

export type EnvVarView = {
  id: string;
  serviceResourceId: string;
  key: string;
  value: string;
};

// ---------------------------------------------------------------------------
// Port input normalization
// ---------------------------------------------------------------------------

export type PortInput = {
  containerPort: number;
  protocol?: "tcp" | "udp";
  appProtocol?: "http" | "tcp";
  isPrimary?: boolean;
};

/**
 * Ensure exactly one primary HTTP port — if the user didn't flag one,
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
    (await inspectSwarmServiceRuntime({
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
      cpuLimit:
        record.service.cpuLimit != null ? Number(record.service.cpuLimit) : null,
      memoryLimitMb: record.service.memoryLimitMb,
      cpuReservation:
        record.service.cpuReservation != null
          ? Number(record.service.cpuReservation)
          : null,
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
    runtime: live,
    createdAt: record.resource.createdAt.toISOString(),
    updatedAt: record.resource.updatedAt.toISOString(),
  };
}

export function mapEnvVar(row: {
  id: string;
  serviceResourceId: string;
  key: string;
  value: string;
}): EnvVarView {
  return {
    id: row.id,
    serviceResourceId: row.serviceResourceId,
    key: row.key,
    value: row.value,
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

export function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}
