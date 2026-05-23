/**
 * Wire types and small string/identifier helpers shared across the project
 * handler split. Wire shapes are inferred from the oRPC contract so there's a
 * single source of truth.
 */

import type * as z from "zod";

import { reconcile } from "../../caddy";
import {
  getProxyRouteByResourceId,
  updateProxyRoute,
} from "../../caddy/queries";
import { PLATFORM } from "../../constants";
import {
  inspectSwarmPostgresRuntime,
  provisionSwarmPostgres,
  type SwarmPostgresRuntime,
} from "../../swarm";

import {
  postgresResourceSchema,
  projectSchema,
  proxyRouteSchema,
} from "./contract";
import {
  type DatabaseResourceRecord,
  getProjectRecord,
  updateDatabaseResourceRuntime,
  updateDatabaseResourceStatus,
} from "./queries";

export type Project = z.infer<typeof projectSchema>;
export type PostgresResource = z.infer<typeof postgresResourceSchema>;
export type ProxyRoute = z.infer<typeof proxyRouteSchema>;

// ---------------------------------------------------------------------------
// View mappers
// ---------------------------------------------------------------------------

export async function mapDatabaseResource(
  record: DatabaseResourceRecord,
  projectSlug?: string,
): Promise<PostgresResource> {
  const resolvedProjectSlug =
    projectSlug ??
    (await getProjectRecord(record.resource.projectId))?.slug ??
    record.resource.projectId;
  const hydrated = await ensureSwarmRuntimeForRecord(
    record,
    resolvedProjectSlug,
  );
  const runtime = hydrated.runtime;
  const databaseRecord = hydrated.record.database;

  return {
    resourceId: record.resource.id,
    projectId: record.resource.projectId,
    name: record.resource.name,
    type: "database" as const,
    status: record.resource.status,
    engine: "postgres" as const,
    databaseName: databaseRecord.databaseName,
    username: databaseRecord.username,
    password: databaseRecord.password,
    publicHostname: databaseRecord.publicHostname,
    publicPort: databaseRecord.publicPort,
    publicConnectionString: databaseRecord.publicConnectionString,
    internalHostname: databaseRecord.internalHostname,
    internalPort: databaseRecord.internalPort,
    internalConnectionString: databaseRecord.internalConnectionString,
    localConnectionString: buildConnectionString({
      username: databaseRecord.username,
      password: databaseRecord.password,
      hostname: PLATFORM.database.localHost,
      port: PLATFORM.database.publicPort,
      databaseName: databaseRecord.databaseName,
      sslmode: "require",
      sslnegotiation: "direct",
    }),
    upstreamHost: databaseRecord.upstreamHost,
    upstreamPort: databaseRecord.upstreamPort,
    runtime,
  };
}

/**
 * Inspects the live Swarm service for a database record and re-provisions it
 * if missing. Keeps the proxy route and DB status in sync with whatever the
 * Caddy reconciler reports.
 */
export async function ensureSwarmRuntimeForRecord(
  record: DatabaseResourceRecord,
  projectSlug: string,
): Promise<{ record: DatabaseResourceRecord; runtime: SwarmPostgresRuntime }> {
  const serviceName = buildContainerName({
    projectSlug,
    resourceName: record.resource.name,
  });
  const volumeName = buildVolumeName({
    projectSlug,
    resourceName: record.resource.name,
  });
  const existingRuntime = await inspectSwarmPostgresRuntime({
    serviceName,
    volumeName,
    projectSlug,
  });

  if (existingRuntime.status !== "missing") {
    return { record, runtime: existingRuntime };
  }

  const runtime = await provisionSwarmPostgres({
    serviceName,
    volumeName,
    hostnameAlias: record.database.internalHostname,
    databaseName: record.database.databaseName,
    username: record.database.username,
    password: record.database.password,
    projectSlug,
  });

  const existingRoute = await getProxyRouteByResourceId(record.resource.id);
  if (existingRoute) {
    await updateProxyRoute(existingRoute.id, {
      upstreamHost: record.database.internalHostname,
      upstreamPort: PLATFORM.database.internalPort,
    });
  }

  await updateDatabaseResourceRuntime({
    resourceId: record.resource.id,
    upstreamHost: record.database.internalHostname,
    upstreamPort: PLATFORM.database.internalPort,
    caddyLayer4Snippet: "",
  });

  const reconcileResult = await reconcile();
  const isApplied = reconcileResult.applied.includes(record.resource.projectId);

  await updateDatabaseResourceStatus(
    record.resource.id,
    isApplied ? "valid" : "invalid",
  );

  return {
    record: {
      resource: { ...record.resource, status: isApplied ? "valid" : "invalid" },
      database: {
        ...record.database,
        upstreamHost: record.database.internalHostname,
        upstreamPort: PLATFORM.database.internalPort,
        caddyLayer4Snippet: "",
      },
    },
    runtime,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function sanitizeProjectSlug(projectId: string): string {
  const value = projectId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value.length > 0 ? value : "project";
}

export function sanitizeDatabaseName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "database";
}

export function clampPostgresIdentifier(value: string): string {
  return value.slice(0, 63);
}

export function sanitizeDockerName(value: string) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized.slice(0, 63) || "otterstack-postgres";
}

export function buildContainerName(input: {
  projectSlug: string;
  resourceName: string;
}) {
  return sanitizeDockerName(
    `otterstack-pg-${sanitizeProjectSlug(input.projectSlug)}-${sanitizeDatabaseName(input.resourceName)}`,
  );
}

export function buildVolumeName(input: {
  projectSlug: string;
  resourceName: string;
}) {
  return sanitizeDockerName(
    `otterstack-pgdata-${sanitizeProjectSlug(input.projectSlug)}-${sanitizeDatabaseName(input.resourceName)}`,
  );
}

export function buildConnectionString(input: {
  username: string;
  password: string;
  hostname: string;
  port?: number;
  databaseName: string;
  sslmode?: "require";
  sslnegotiation?: "direct";
}) {
  const hostPort = input.port
    ? `${input.hostname}:${input.port}`
    : input.hostname;
  const url = new URL(
    `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${hostPort}/${encodeURIComponent(input.databaseName)}`,
  );

  if (input.sslmode) {
    url.searchParams.set("sslmode", input.sslmode);
  }

  if (input.sslnegotiation) {
    url.searchParams.set("sslnegotiation", input.sslnegotiation);
  }

  return url.toString();
}

export function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}
