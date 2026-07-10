/**
 * Wire types and small string/identifier helpers shared across the project
 * handler split. Wire shapes are inferred from the oRPC contract so there's a
 * single source of truth.
 */

import type * as z from "zod";

import type { ServiceEnvVarRow } from "../service/queries";

import { PLATFORM } from "../../constants";
import { getEngineAdapter } from "../../swarm";
import { listServiceEnvVars } from "../service/queries";
import {
  composeResourceSchema,
  postgresResourceSchema,
  projectListItemSchema,
  projectSchema,
  proxyRouteSchema,
  serviceResourceSchema,
} from "./contract";
import { ensureSwarmRuntimeForRecord } from "./database-runtime-recovery";
import { getLatestDeploymentForResource, type DeploymentRow } from "./deployments";
import {
  type ComposeResourceJoined,
  type DatabaseResourceRecord,
  type ServiceResourceJoined,
  getProjectRecord,
} from "./queries";
import { buildConnectionString } from "./view-helpers";

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

/** Latest-deployment pill status + start/finish ISO timestamps (drive the node
 *  build duration). Build-time states (failed/building) schedule no swarm tasks,
 *  so this is the only status signal the live-task rollup can't surface. */
function latestDeploymentFields(latest: DeploymentRow | null) {
  return {
    latestDeploymentStatus: latest?.status ?? null,
    latestDeploymentStartedAt: latest ? latest.createdAt.toISOString() : null,
    latestDeploymentFinishedAt: latest?.completedAt ? latest.completedAt.toISOString() : null,
  };
}

/** Use the batch caller's pre-fetched latest-deployment row when supplied (the
 *  list path resolves all resources' latest deployments in one query); else
 *  fetch the single indexed row (single-resource callers). `undefined` = not
 *  supplied → fetch; `null` = supplied, resource has no deployment. */
async function resolveLatest(
  resourceId: string,
  provided: DeploymentRow | null | undefined,
): Promise<DeploymentRow | null> {
  if (provided !== undefined) return provided;
  return getLatestDeploymentForResource(
    resourceId as Parameters<typeof getLatestDeploymentForResource>[0],
  );
}

/**
 * Service-resource view mapper. Joins the user-authored env bag into the
 * response so the resource panel's Variables tab can render without a
 * second fetch — same shape as the database mapper. Live task state and
 * ports still come from their dedicated procedures.
 */
export async function mapServiceResource(
  record: ServiceResourceJoined,
  opts?: { latest?: DeploymentRow | null; envRows?: ServiceEnvVarRow[] },
): Promise<ServiceResourceView> {
  const envRows =
    opts?.envRows ??
    (await listServiceEnvVars(
      record.resource.id as unknown as Parameters<typeof listServiceEnvVars>[0],
    ));
  const extraEnv: Record<string, string> = {};
  const secretKeys: string[] = [];
  for (const row of envRows) {
    extraEnv[row.key] = row.value;
    if (row.isSecret) secretKeys.push(row.key);
  }
  return {
    resourceId: record.resource.id,
    projectId: record.resource.projectId,
    name: record.resource.name,
    type: "service" as const,
    status: record.resource.status,
    ...latestDeploymentFields(await resolveLatest(record.resource.id, opts?.latest)),
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
  opts?: { latest?: DeploymentRow | null },
): Promise<ComposeResourceView> {
  return {
    resourceId: record.resource.id,
    projectId: record.resource.projectId,
    name: record.resource.name,
    type: "compose" as const,
    status: record.resource.status,
    ...latestDeploymentFields(await resolveLatest(record.resource.id, opts?.latest)),
    source: record.compose.source,
    stackName: record.compose.stackName,
    logoBrand: record.compose.logoBrand ?? null,
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
