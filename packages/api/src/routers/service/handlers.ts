/**
 * Orchestration layer for the Service primitive. Stitches together the
 * queries module, the Swarm provisioner, the variable resolver, and the
 * Caddy reconciler.
 *
 * Returns discriminated-union results (matching the existing project router
 * style) so the oRPC handler layer can translate to the right error code.
 */

import type { RequestLogger } from "evlog";

import { getProjectRecord } from "@otterstack/db/project-resource";

import { reconcile } from "../../caddy";
import {
  deleteProxyRoutesByResource,
  insertProxyRoute,
} from "../../caddy/queries";
import { PLATFORM } from "../../constants";
import {
  bulkReplaceServiceEnvVars,
  bumpForceUpdateCounter,
  createServiceRecord,
  deleteServiceEnvVar,
  deleteServiceRecord,
  findServiceDependentsByName,
  getPrimaryHttpPort,
  getServiceRecord,
  getServiceRecordByName,
  listServiceRecordsByProject,
  replaceServicePorts,
  type ServiceRecord,
  setPublicExposure,
  updateServiceRecord,
  updateServiceResourceStatus,
  upsertServiceEnvVar,
} from "../../lib/queries/service";
import {
  findTransitiveDependents,
  resolveServiceEnv,
  type ResolveError,
} from "../../lib/variables";
import {
  destroySwarmService,
  inspectSwarmServiceRuntime,
  provisionSwarmService,
  type SwarmServiceRuntime,
  type SwarmServiceSpec,
  updateSwarmService,
} from "../../swarm";

// ---------------------------------------------------------------------------
// Views & result types
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

type Ok<T> = { ok: true; value: T };
type Err<K extends string, Extra = unknown> = { ok: false; reason: K; cause?: Extra };

export type ServiceFailureReason =
  | "project_not_found"
  | "service_not_found"
  | "service_conflict"
  | "no_http_port"
  | "in_use"
  | "ref_missing"
  | "ref_cycle"
  | "ref_unknown_var"
  | "ref_parse_error";

type ServiceResult<T> = Ok<T> | Err<ServiceFailureReason, ResolveError | string>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listServices(input: {
  projectId: string;
}): Promise<ServiceResult<ServiceView[]>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const records = await listServiceRecordsByProject(input.projectId);
  const views = await Promise.all(records.map((r) => mapServiceView(r, project.slug)));
  return { ok: true, value: views };
}

export async function getService(input: {
  projectId: string;
  resourceId: string;
}): Promise<ServiceResult<ServiceView>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const record = await getServiceRecord(input.projectId, input.resourceId);
  if (!record) return { ok: false, reason: "service_not_found" };

  return { ok: true, value: await mapServiceView(record, project.slug) };
}

export type CreateServiceInput = {
  projectId: string;
  name: string;
  image: string;
  command?: string[] | null;
  entrypoint?: string[] | null;
  replicas?: number;

  ports: Array<{
    containerPort: number;
    protocol?: "tcp" | "udp";
    appProtocol?: "http" | "tcp";
    isPrimary?: boolean;
  }>;
  env?: Array<{ key: string; value: string }>;

  restart?: {
    condition?: "none" | "on-failure" | "any";
    maxAttempts?: number | null;
    delayMs?: number;
  };

  healthcheck?: {
    cmd?: string[] | null;
    intervalMs?: number | null;
    timeoutMs?: number | null;
    retries?: number | null;
    startMs?: number | null;
  } | null;

  resources?: {
    cpuLimit?: number | null;
    memoryLimitMb?: number | null;
    cpuReservation?: number | null;
    memoryReservationMb?: number | null;
  };
};

export async function createService(
  input: CreateServiceInput,
  log: RequestLogger,
): Promise<ServiceResult<ServiceView>> {
  log.set({ resource: { kind: "service", projectId: input.projectId, name: input.name } });

  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const existing = await getServiceRecordByName(input.projectId, input.name);
  if (existing) return { ok: false, reason: "service_conflict" };

  const projectSlug = sanitizeSlug(project.slug);
  const resourceSlug = sanitizeSlug(input.name);
  const serviceName = `${PLATFORM.service.serviceNamePrefix}${projectSlug}-${resourceSlug}`.slice(0, 63);
  const networkName = `${PLATFORM.swarm.networkPrefix}${projectSlug}`;
  const internalHostname = resourceSlug;

  // Ensure exactly one primary HTTP port — if user didn't flag one,
  // promote the first HTTP port. No-op if there are no HTTP ports.
  const ports = normalizePorts(input.ports);

  let record: ServiceRecord;
  try {
    record = await createServiceRecord({
      projectId: input.projectId,
      name: input.name,
      status: "draft",
      image: input.image,
      command: input.command ?? null,
      entrypoint: input.entrypoint ?? null,
      replicas: input.replicas ?? 1,
      restartCondition: input.restart?.condition,
      restartMaxAttempts: input.restart?.maxAttempts ?? null,
      restartDelayMs: input.restart?.delayMs,
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
      internalHostname,
      serviceName,
      networkName,
      ports,
      env: input.env,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "service_conflict" };
    }
    throw error;
  }

  // Resolve env (may fail with ref errors)
  const resolved = await resolveServiceEnv(input.projectId, record.service.resourceId);
  if (!resolved.ok) {
    await updateServiceResourceStatus(record.service.resourceId, "invalid");
    return mapResolveError(resolved.error);
  }

  // Provision the swarm service
  const runtime = await provisionSwarmService(
    buildSwarmSpec(record, resolved.env, projectSlug),
  );
  log.set({ provision: { service: serviceName, status: runtime.status } });

  await updateServiceResourceStatus(
    record.service.resourceId,
    runtime.status === "error" ? "invalid" : "valid",
  );

  const refreshed = await getServiceRecord(input.projectId, record.service.resourceId);
  return {
    ok: true,
    value: await mapServiceView(refreshed ?? record, projectSlug, runtime),
  };
}

export type UpdateServiceInput = {
  projectId: string;
  resourceId: string;
  image?: string;
  command?: string[] | null;
  entrypoint?: string[] | null;
  replicas?: number;
  ports?: Array<{
    containerPort: number;
    protocol?: "tcp" | "udp";
    appProtocol?: "http" | "tcp";
    isPrimary?: boolean;
  }>;
  restart?: {
    condition?: "none" | "on-failure" | "any";
    maxAttempts?: number | null;
    delayMs?: number;
  };
  healthcheck?: {
    cmd?: string[] | null;
    intervalMs?: number | null;
    timeoutMs?: number | null;
    retries?: number | null;
    startMs?: number | null;
  } | null;
  resources?: {
    cpuLimit?: number | null;
    memoryLimitMb?: number | null;
    cpuReservation?: number | null;
    memoryReservationMb?: number | null;
  };
};

export async function updateService(
  input: UpdateServiceInput,
  log: RequestLogger,
): Promise<ServiceResult<ServiceView>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const existing = await getServiceRecord(input.projectId, input.resourceId);
  if (!existing) return { ok: false, reason: "service_not_found" };

  await updateServiceRecord(input.resourceId, {
    image: input.image,
    command: input.command,
    entrypoint: input.entrypoint,
    replicas: input.replicas,
    restartCondition: input.restart?.condition,
    restartMaxAttempts: input.restart?.maxAttempts,
    restartDelayMs: input.restart?.delayMs,
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
  });

  if (input.ports) {
    await replaceServicePorts(input.resourceId, normalizePorts(input.ports));
  }

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    project.slug,
    log,
  );
  if (!redeployed.ok) return redeployed;

  return getService(input);
}

export async function deleteService(
  input: { projectId: string; resourceId: string },
  log: RequestLogger,
): Promise<ServiceResult<{ ok: true }>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const record = await getServiceRecord(input.projectId, input.resourceId);
  if (!record) return { ok: false, reason: "service_not_found" };

  // Block deletion if other services reference us.
  const dependents = await findServiceDependentsByName({
    projectId: input.projectId,
    targetResourceName: record.resource.name,
  });
  const externalDependents = dependents.filter((id) => id !== input.resourceId);
  if (externalDependents.length > 0) {
    return { ok: false, reason: "in_use", cause: externalDependents.join(",") };
  }

  await deleteProxyRoutesByResource(input.resourceId);
  await destroySwarmService({ serviceName: record.service.serviceName });
  await deleteServiceRecord(input.resourceId);
  await reconcile();

  log.set({ teardown: { service: record.service.serviceName, ok: true } });

  return { ok: true, value: { ok: true } };
}

export async function restartService(
  input: { projectId: string; resourceId: string },
  log: RequestLogger,
): Promise<ServiceResult<ServiceView>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const existing = await getServiceRecord(input.projectId, input.resourceId);
  if (!existing) return { ok: false, reason: "service_not_found" };

  await bumpForceUpdateCounter(input.resourceId);

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    project.slug,
    log,
  );
  if (!redeployed.ok) return redeployed;

  return getService(input);
}

export async function exposeService(
  input: { projectId: string; resourceId: string },
  log: RequestLogger,
): Promise<ServiceResult<ServiceView>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const record = await getServiceRecord(input.projectId, input.resourceId);
  if (!record) return { ok: false, reason: "service_not_found" };

  const primary = getPrimaryHttpPort(record.ports);
  if (!primary) return { ok: false, reason: "no_http_port" };

  const projectSlug = sanitizeSlug(project.slug);
  const resourceSlug = sanitizeSlug(record.resource.name);
  const publicDomain =
    record.service.publicDomain ??
    `${resourceSlug}-${projectSlug}.${PLATFORM.service.publicBaseDomain}`;

  await setPublicExposure({
    resourceId: input.resourceId,
    enabled: true,
    publicDomain,
  });

  // Drop any pre-existing proxy_routes for this resource and re-insert.
  await deleteProxyRoutesByResource(input.resourceId);
  await insertProxyRoute({
    projectId: input.projectId,
    resourceId: input.resourceId,
    type: "http",
    domain: publicDomain,
    upstreamHost: record.service.internalHostname,
    upstreamPort: primary.containerPort,
    protocol: "http",
  });

  const reconcileResult = await reconcile();
  log.set({
    expose: {
      domain: publicDomain,
      applied: reconcileResult.applied.includes(input.projectId),
    },
  });

  return getService(input);
}

export async function unexposeService(
  input: { projectId: string; resourceId: string },
  log: RequestLogger,
): Promise<ServiceResult<ServiceView>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const record = await getServiceRecord(input.projectId, input.resourceId);
  if (!record) return { ok: false, reason: "service_not_found" };

  await deleteProxyRoutesByResource(input.resourceId);
  await setPublicExposure({
    resourceId: input.resourceId,
    enabled: false,
    publicDomain: null,
  });
  await reconcile();
  log.set({ unexpose: { service: record.service.serviceName } });

  return getService(input);
}

export async function listEnv(input: {
  projectId: string;
  resourceId: string;
}): Promise<ServiceResult<EnvVarView[]>> {
  const record = await getServiceRecord(input.projectId, input.resourceId);
  if (!record) return { ok: false, reason: "service_not_found" };
  return { ok: true, value: record.env.map(mapEnvVar) };
}

export async function setEnv(
  input: { projectId: string; resourceId: string; key: string; value: string },
  log: RequestLogger,
): Promise<ServiceResult<EnvVarView>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const record = await getServiceRecord(input.projectId, input.resourceId);
  if (!record) return { ok: false, reason: "service_not_found" };

  const row = await upsertServiceEnvVar({
    serviceResourceId: input.resourceId,
    key: input.key,
    value: input.value,
  });

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    project.slug,
    log,
  );
  if (!redeployed.ok) return redeployed;

  return { ok: true, value: mapEnvVar(row) };
}

export async function unsetEnv(
  input: { projectId: string; resourceId: string; key: string },
  log: RequestLogger,
): Promise<ServiceResult<{ ok: true }>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const record = await getServiceRecord(input.projectId, input.resourceId);
  if (!record) return { ok: false, reason: "service_not_found" };

  const removed = await deleteServiceEnvVar({
    serviceResourceId: input.resourceId,
    key: input.key,
  });
  if (!removed) return { ok: false, reason: "service_not_found" };

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    project.slug,
    log,
  );
  if (!redeployed.ok) return redeployed;

  return { ok: true, value: { ok: true } };
}

export async function bulkSetEnv(
  input: {
    projectId: string;
    resourceId: string;
    vars: Array<{ key: string; value: string }>;
  },
  log: RequestLogger,
): Promise<ServiceResult<EnvVarView[]>> {
  const project = await getProjectRecord(input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const record = await getServiceRecord(input.projectId, input.resourceId);
  if (!record) return { ok: false, reason: "service_not_found" };

  const rows = await bulkReplaceServiceEnvVars(input.resourceId, input.vars);
  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    project.slug,
    log,
  );
  if (!redeployed.ok) return redeployed;

  return { ok: true, value: rows.map(mapEnvVar) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function redeployAndFanOut(
  projectId: string,
  resourceId: string,
  projectSlug: string,
  log: RequestLogger,
): Promise<ServiceResult<true>> {
  const result = await redeployOne(projectId, resourceId, projectSlug);
  if (!result.ok) return result;

  const sourceRecord = await getServiceRecord(projectId, resourceId);
  if (!sourceRecord) return { ok: true, value: true };

  const dependents = await findTransitiveDependents({
    projectId,
    targetResourceId: resourceId,
    targetResourceName: sourceRecord.resource.name,
  });

  log.set({ fanout: { count: dependents.length } });

  for (const depId of dependents) {
    const depResult = await redeployOne(projectId, depId, projectSlug);
    if (!depResult.ok) {
      // One failed dependent shouldn't undo the rest, but we surface the first error.
      return depResult;
    }
  }

  return { ok: true, value: true };
}

async function redeployOne(
  projectId: string,
  resourceId: string,
  projectSlug: string,
): Promise<ServiceResult<true>> {
  const record = await getServiceRecord(projectId, resourceId);
  if (!record) return { ok: false, reason: "service_not_found" };

  const resolved = await resolveServiceEnv(projectId, resourceId);
  if (!resolved.ok) {
    await updateServiceResourceStatus(resourceId, "invalid");
    return mapResolveError(resolved.error);
  }

  const runtime = await updateSwarmService(
    buildSwarmSpec(record, resolved.env, sanitizeSlug(projectSlug)),
  );
  await updateServiceResourceStatus(
    resourceId,
    runtime.status === "error" ? "invalid" : "valid",
  );

  return { ok: true, value: true };
}

function buildSwarmSpec(
  record: ServiceRecord,
  resolvedEnv: Record<string, string>,
  projectSlug: string,
): SwarmServiceSpec {
  return {
    resourceId: record.resource.id,
    resourceName: record.resource.name,
    projectSlug: sanitizeSlug(projectSlug),
    serviceName: record.service.serviceName,
    internalHostname: record.service.internalHostname,
    image: record.service.image,
    command: record.service.command,
    entrypoint: record.service.entrypoint,
    env: resolvedEnv,
    replicas: record.service.replicas,
    restart: {
      condition: record.service.restartCondition,
      maxAttempts: record.service.restartMaxAttempts,
      delayMs: record.service.restartDelayMs,
    },
    healthcheck: record.service.healthcheckCmd
      ? {
          cmd: record.service.healthcheckCmd,
          intervalMs: record.service.healthcheckIntervalMs ?? 30_000,
          timeoutMs: record.service.healthcheckTimeoutMs ?? 5_000,
          retries: record.service.healthcheckRetries ?? 3,
          startPeriodMs: record.service.healthcheckStartMs ?? 0,
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
      containerPort: p.containerPort,
      protocol: p.protocol,
      appProtocol: p.appProtocol,
    })),
    forceUpdateCounter: record.service.forceUpdateCounter,
  };
}

function normalizePorts(ports: CreateServiceInput["ports"]) {
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

async function mapServiceView(
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

function mapEnvVar(row: {
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

function mapResolveError(error: ResolveError): Err<ServiceFailureReason, ResolveError> {
  switch (error.kind) {
    case "missing_resource":
    case "missing_database_record":
    case "missing_service_record":
      return { ok: false, reason: "ref_missing", cause: error };
    case "cycle":
      return { ok: false, reason: "ref_cycle", cause: error };
    case "unknown_var":
      return { ok: false, reason: "ref_unknown_var", cause: error };
    case "parse_error":
      return { ok: false, reason: "ref_parse_error", cause: error };
    case "unsupported_resource_type":
      return { ok: false, reason: "ref_missing", cause: error };
  }
}

function sanitizeSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 32) : "x";
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}
