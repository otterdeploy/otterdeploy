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
  defaultImageFor,
  getEngineAdapter,
  inspectSwarmDatabaseRuntime,
  provisionSwarmDatabase,
  type SwarmDatabaseRuntime,
} from "../../swarm";

import {
  postgresResourceSchema,
  projectListItemSchema,
  projectSchema,
  proxyRouteSchema,
  serviceResourceSchema,
} from "./contract";
import { deleteDeploymentById, insertDeployment } from "./deployments";
import {
  type DatabaseResourceRecord,
  type ServiceResourceJoined,
  getProjectRecord,
  updateDatabaseResourceRuntime,
  updateDatabaseResourceStatus,
} from "./queries";

export type Project = z.infer<typeof projectSchema>;
export type ProjectListItem = z.infer<typeof projectListItemSchema>;
export type PostgresResource = z.infer<typeof postgresResourceSchema>;
export type ServiceResourceView = z.infer<typeof serviceResourceSchema>;
export type ProjectResource = PostgresResource | ServiceResourceView;
export type ProxyRoute = z.infer<typeof proxyRouteSchema>;

// ---------------------------------------------------------------------------
// View mappers
// ---------------------------------------------------------------------------

/**
 * Service-resource view mapper. Returns the slim shape exposed by the resource
 * list — no live task state, no env vars, no ports. Those come later via
 * dedicated procedures (service.tasks / service.env.list / etc.).
 */
export function mapServiceResource(record: ServiceResourceJoined): ServiceResourceView {
  return {
    resourceId: record.resource.id,
    projectId: record.resource.projectId,
    name: record.resource.name,
    type: "service" as const,
    status: record.resource.status,
    image: record.service.image,
    imageDigest: record.service.imageDigest,
    replicas: record.service.replicas,
    publicEnabled: record.service.publicEnabled,
    publicDomain: record.service.publicDomain,
    preDeploy: record.service.preDeploy ?? null,
    buildConfig: record.service.buildConfig ?? null,
    restartWindowMs: record.service.restartWindowMs ?? null,
    diskLimitMb: record.service.diskLimitMb ?? null,
    swapLimitMb: record.service.swapLimitMb ?? null,
    pidsLimit: record.service.pidsLimit ?? null,
  };
}

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
    // Read the engine off the row, not a hardcoded literal — the row IS
    // the source of truth, the wizard's selection landed here when the
    // resource was created. Every UI surface (icon, copy, connection
    // string template) reads this field; hardcoding it made redis /
    // mariadb / mongo resources all render as postgres.
    engine: databaseRecord.engine,
    databaseName: databaseRecord.databaseName,
    username: databaseRecord.username,
    password: databaseRecord.password,
    publicEnabled: databaseRecord.publicEnabled,
    publicHostname: databaseRecord.publicHostname,
    publicPort: databaseRecord.publicPort,
    // Recompute from the adapter on every read instead of trusting the
    // stored column. Stored URLs from before we made port optional still
    // carry a stale ":5432"; recomputing means old rows auto-heal without
    // a migration, and any future tweak to the URL format (e.g. query
    // params) takes effect immediately.
    publicConnectionString: getEngineAdapter(
      databaseRecord.engine,
    ).buildConnectionString({
      username: databaseRecord.username,
      password: databaseRecord.password,
      host: databaseRecord.publicHostname,
      databaseName: databaseRecord.databaseName,
      sslmode: "require",
      sslnegotiation: "direct",
    }),
    internalHostname: databaseRecord.internalHostname,
    internalPort: databaseRecord.internalPort,
    internalConnectionString: databaseRecord.internalConnectionString,
    // Public-side connection strings never include the port. Everything
    // public goes through Caddy on 443 — implicit for HTTPS-style URLs and
    // the operator should never see :443 in copyable text.
    localConnectionString: buildConnectionString({
      username: databaseRecord.username,
      password: databaseRecord.password,
      hostname: PLATFORM.database.localHost,
      databaseName: databaseRecord.databaseName,
      sslmode: "require",
      sslnegotiation: "direct",
    }),
    upstreamHost: databaseRecord.upstreamHost,
    upstreamPort: databaseRecord.upstreamPort,
    runtime,
    extraEnv: databaseRecord.extraEnv ?? {},
    secretKeys: databaseRecord.secretKeys ?? [],
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
): Promise<{ record: DatabaseResourceRecord; runtime: SwarmDatabaseRuntime }> {
  const serviceName = buildContainerName({
    projectSlug,
    resourceName: record.resource.name,
  });
  const volumeName = buildVolumeName({
    projectSlug,
    resourceName: record.resource.name,
  });
  // Engine comes from the row, never from a hardcoded default — the
  // recovery path here used to call `provisionSwarmPostgres`, which
  // forced a postgres image regardless of what the user actually
  // created. That's how a "redis" resource ended up running
  // `postgres:17-alpine` after its first page load.
  const engine = record.database.engine;
  const engineImage = defaultImageFor(engine);

  const existingRuntime = await inspectSwarmDatabaseRuntime({
    serviceName,
    volumeName,
    projectSlug,
  });

  if (existingRuntime.status !== "missing") {
    return { record, runtime: existingRuntime };
  }

  // The swarm service disappeared (manual `docker service rm`, drained
  // node that never came back, etc.). Re-create it under a fresh
  // deployment so the recovery shows up in the Deployments tab.
  const restartDeployment = await insertDeployment({
    resourceId: record.resource.id,
    image: engineImage,
    reason: "restart",
    snapshot: {
      kind: "postgres",
      version: 1,
      image: engineImage,
      databaseName: record.database.databaseName,
      username: record.database.username,
      password: record.database.password,
      publicEnabled: record.database.publicEnabled,
      publicHostname: record.database.publicHostname,
      internalHostname: record.database.internalHostname,
      extraEnv: record.database.extraEnv ?? {},
    },
  });

  const runtime = await provisionSwarmDatabase({
    engine,
    serviceName,
    volumeName,
    hostnameAlias: record.database.internalHostname,
    databaseName: record.database.databaseName,
    username: record.database.username,
    password: record.database.password,
    projectSlug,
    deploymentId: restartDeployment.id,
    extraEnv: record.database.extraEnv ?? {},
    public: record.database.publicEnabled,
  });

  // Race close-out: between our initial `inspectSwarmDatabaseRuntime`
  // (which said "missing") and the inner inspect that provisionSwarm-
  // Database does, another caller may have brought the service up. In
  // that case provisionSwarmDatabase short-circuits and never schedules
  // a task carrying our restart deployment.id label — the row would
  // stay BUILDING with 0 tasks forever. Drop it. The other caller's
  // deployment row is the truthful one.
  if (runtime.wasCreated === false) {
    await deleteDeploymentById(restartDeployment.id);
    return { record, runtime };
  }

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

  return sanitized.slice(0, 63) || "otterdeploy-postgres";
}

export function buildContainerName(input: {
  projectSlug: string;
  resourceName: string;
}) {
  return sanitizeDockerName(
    `otterdeploy-pg-${sanitizeProjectSlug(input.projectSlug)}-${sanitizeDatabaseName(input.resourceName)}`,
  );
}

export function buildVolumeName(input: {
  projectSlug: string;
  resourceName: string;
}) {
  return sanitizeDockerName(
    `otterdeploy-pgdata-${sanitizeProjectSlug(input.projectSlug)}-${sanitizeDatabaseName(input.resourceName)}`,
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
