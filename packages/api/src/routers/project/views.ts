/**
 * Wire types and small string/identifier helpers shared across the project
 * handler split. Wire shapes are inferred from the oRPC contract so there's a
 * single source of truth.
 */

import type * as z from "zod";

import { reconcile } from "../../caddy";
import { getProxyRouteByResourceId, updateProxyRoute } from "../../caddy/queries";
import { PLATFORM } from "../../constants";
import { inspectSwarmDatabaseRuntime, provisionSwarmDatabase } from "../../runtime/db";
import { defaultImageFor, getEngineAdapter, type SwarmDatabaseRuntime } from "../../swarm";
import { listServiceEnvVars } from "../service/queries";
import {
  composeResourceSchema,
  postgresResourceSchema,
  projectListItemSchema,
  projectSchema,
  proxyRouteSchema,
  serviceResourceSchema,
} from "./contract";
import {
  deleteDeploymentById,
  getLatestDeploymentForResource,
  insertDeployment,
} from "./deployments";
import {
  type ComposeResourceJoined,
  type DatabaseResourceRecord,
  type ServiceResourceJoined,
  getProjectRecord,
  updateDatabaseResourceRuntime,
  updateDatabaseResourceStatus,
} from "./queries";
import { buildConnectionString, buildContainerName, buildVolumeName } from "./view-helpers";

export type Project = z.infer<typeof projectSchema>;
export type ProjectListItem = z.infer<typeof projectListItemSchema>;
export type PostgresResource = z.infer<typeof postgresResourceSchema>;
export type ServiceResourceView = z.infer<typeof serviceResourceSchema>;
export type ComposeResourceView = z.infer<typeof composeResourceSchema>;
export type ProjectResource = PostgresResource | ServiceResourceView | ComposeResourceView;
export type ProxyRoute = z.infer<typeof proxyRouteSchema>;

// ---------------------------------------------------------------------------
// View mappers
// ---------------------------------------------------------------------------

/**
 * Service-resource view mapper. Joins the user-authored env bag into the
 * response so the resource panel's Variables tab can render without a
 * second fetch — same shape as the database mapper. Live task state and
 * ports still come from their dedicated procedures.
 */
export async function mapServiceResource(
  record: ServiceResourceJoined,
): Promise<ServiceResourceView> {
  const envRows = await listServiceEnvVars(
    record.resource.id as unknown as Parameters<typeof listServiceEnvVars>[0],
  );
  const extraEnv: Record<string, string> = {};
  const secretKeys: string[] = [];
  for (const row of envRows) {
    extraEnv[row.key] = row.value;
    if (row.isSecret) secretKeys.push(row.key);
  }
  // Latest deployment's stored status — surfaced so the graph node reflects
  // build-time states (failed/building/pending) that schedule no swarm tasks
  // and thus never show up in the live-task rollup. Single indexed row, no
  // docker round-trip.
  const latestDeployment = await getLatestDeploymentForResource(
    record.resource.id as Parameters<typeof getLatestDeploymentForResource>[0],
  );
  return {
    resourceId: record.resource.id,
    projectId: record.resource.projectId,
    name: record.resource.name,
    type: "service" as const,
    status: record.resource.status,
    latestDeploymentStatus: latestDeployment?.status ?? null,
    image: record.service.image,
    imageDigest: record.service.imageDigest,
    source: record.service.source,
    sourceSubdir: record.service.sourceSubdir,
    framework: record.service.framework ?? null,
    replicas: record.service.replicas,
    stackId: record.service.stackId ?? null,
    publicEnabled: record.service.publicEnabled,
    publicDomain: record.service.publicDomain,
    extraEnv,
    secretKeys,
    preDeploy: record.service.preDeploy ?? null,
    postDeploy: record.service.postDeploy ?? null,
    buildConfig: record.service.buildConfig ?? null,
    restartWindowMs: record.service.restartWindowMs ?? null,
    diskLimitMb: record.service.diskLimitMb ?? null,
    swapLimitMb: record.service.swapLimitMb ?? null,
    pidsLimit: record.service.pidsLimit ?? null,
  };
}

export async function mapComposeResource(
  record: ComposeResourceJoined,
): Promise<ComposeResourceView> {
  const latestDeployment = await getLatestDeploymentForResource(
    record.resource.id as Parameters<typeof getLatestDeploymentForResource>[0],
  );
  return {
    resourceId: record.resource.id,
    projectId: record.resource.projectId,
    name: record.resource.name,
    type: "compose" as const,
    status: record.resource.status,
    latestDeploymentStatus: latestDeployment?.status ?? null,
    source: record.compose.source,
    stackName: record.compose.stackName,
    services: record.compose.services,
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
  const hydrated = await ensureSwarmRuntimeForRecord(record, resolvedProjectSlug);
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
    publicConnectionString: getEngineAdapter(databaseRecord.engine).buildConnectionString({
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
    extensions: databaseRecord.extensions ?? [],
  };
}

/**
 * Inspects the live Swarm service for a database record and re-provisions it
 * if missing. Keeps the proxy route and DB status in sync with whatever the
 * Caddy reconciler reports.
 */
async function ensureSwarmRuntimeForRecord(
  record: DatabaseResourceRecord,
  projectSlug: string,
): Promise<{ record: DatabaseResourceRecord; runtime: SwarmDatabaseRuntime }> {
  // Engine comes from the row, never from a hardcoded default — the
  // recovery path here used to call `provisionSwarmPostgres`, which
  // forced a postgres image regardless of what the user actually
  // created. That's how a "redis" resource ended up running
  // `postgres:17-alpine` after its first page load.
  const engine = record.database.engine;
  const serviceName = buildContainerName({
    engine,
    projectSlug,
    resourceName: record.resource.name,
  });
  const volumeName = buildVolumeName({
    engine,
    projectSlug,
    resourceName: record.resource.name,
  });
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
    resourceId: record.resource.id,
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

  await updateDatabaseResourceStatus(record.resource.id, isApplied ? "valid" : "invalid");

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
// Small helpers — re-exported from the leaf ./view-helpers module so the
// project handler split keeps importing them from "./views".
// ---------------------------------------------------------------------------

export {
  buildContainerName,
  buildVolumeName,
  clampPostgresIdentifier,
  isUniqueViolation,
  sanitizeDatabaseName,
  sanitizeDockerName,
  sanitizeProjectSlug,
} from "./view-helpers";
