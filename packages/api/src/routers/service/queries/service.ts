import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  resource,
  serviceEnvVar,
  serviceMount,
  servicePort,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { omitUndefined } from "@otterdeploy/shared/object";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createError } from "evlog";

import {
  type ServiceMountRow,
  type ServicePortRow,
  type ServiceEnvVarRow,
  type ServiceRecord,
  type ServiceResourceRow,
} from ".";
import { listServiceEnvVars } from "./env";
import { listServiceMounts } from "./mounts";
import { listServicePorts } from "./ports";
import {
  type CreateServiceInput,
  serviceCoreColumns,
  serviceDeployColumns,
  serviceHealthcheckColumns,
  serviceResourceColumns,
  serviceRestartColumns,
} from "./service-columns";

export type { CreateServiceInput } from "./service-columns";
// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getServiceRecord(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<ServiceRecord | undefined> {
  const [row] = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.id, resourceId)))
    .limit(1);

  if (!row) return undefined;

  const [ports, env, mounts] = await Promise.all([
    listServicePorts(row.service.resourceId),
    listServiceEnvVars(row.service.resourceId),
    listServiceMounts(row.service.resourceId),
  ]);
  return { resource: row.resource, service: row.service, ports, env, mounts };
}

export async function getServiceRecordByName(
  projectId: ProjectId,
  name: string,
): Promise<ServiceRecord | undefined> {
  const [row] = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.name, name)))
    .limit(1);

  if (!row) return undefined;

  const [ports, env, mounts] = await Promise.all([
    listServicePorts(row.service.resourceId),
    listServiceEnvVars(row.service.resourceId),
    listServiceMounts(row.service.resourceId),
  ]);
  return { resource: row.resource, service: row.service, ports, env, mounts };
}

export async function listServiceRecordsByProject(projectId: ProjectId): Promise<ServiceRecord[]> {
  const rows = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(eq(resource.projectId, projectId));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.service.resourceId);
  const [allPorts, allEnv, allMounts]: [ServicePortRow[], ServiceEnvVarRow[], ServiceMountRow[]] =
    await Promise.all([
      db.select().from(servicePort).where(inArray(servicePort.serviceResourceId, ids)),
      db
        .select()
        .from(serviceEnvVar)
        .where(and(inArray(serviceEnvVar.serviceResourceId, ids), isNull(serviceEnvVar.previewId))),
      db.select().from(serviceMount).where(inArray(serviceMount.serviceResourceId, ids)),
    ]);

  return rows.map((row) => ({
    resource: row.resource,
    service: row.service,
    ports: allPorts.filter((p) => p.serviceResourceId === row.service.resourceId),
    env: allEnv.filter((e) => e.serviceResourceId === row.service.resourceId),
    mounts: allMounts.filter((m) => m.serviceResourceId === row.service.resourceId),
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createServiceRecord(input: CreateServiceInput): Promise<ServiceRecord> {
  return db.transaction(async (tx) => {
    const [createdResource] = await tx
      .insert(resource)
      .values({
        projectId: input.projectId,
        name: input.name,
        type: "service",
        status: input.status ?? "draft",
      })
      .returning();
    if (!createdResource) {
      throw createError({
        message: "Failed to create service resource row",
        status: 500,
        why: "Database insert returned no row for the service resource",
      });
    }

    const [createdService] = await tx
      .insert(serviceResource)
      .values({
        resourceId: createdResource.id,
        image: input.image,
        ...serviceCoreColumns(input),
        ...serviceRestartColumns(input),
        ...serviceHealthcheckColumns(input),
        ...serviceResourceColumns(input),
        ...serviceDeployColumns(input),
        internalHostname: input.internalHostname,
        serviceName: input.serviceName,
        networkName: input.networkName,
      })
      .returning();
    if (!createdService) {
      throw createError({
        message: "Failed to create service_resource sidecar row",
        status: 500,
        why: "Database insert returned no row for the service_resource sidecar",
      });
    }

    const ports = await tx
      .insert(servicePort)
      .values(
        input.ports.map((p) => ({
          serviceResourceId: createdService.resourceId,
          containerPort: p.containerPort,
          protocol: p.protocol ?? "tcp",
          appProtocol: p.appProtocol ?? "http",
          isPrimary: p.isPrimary ?? false,
        })),
      )
      .returning();

    const env =
      !input.env || input.env.length === 0
        ? []
        : await tx
            .insert(serviceEnvVar)
            .values(
              input.env.map((e) => ({
                serviceResourceId: createdService.resourceId,
                key: e.key,
                value: e.value,
              })),
            )
            .returning();

    return {
      resource: createdResource,
      service: createdService,
      ports,
      env,
      mounts: [],
    };
  });
}

export type UpdateServiceInput = Partial<
  Omit<CreateServiceInput, "projectId" | "name" | "ports" | "env">
> & {
  imageDigest?: string | null;
};

export async function updateServiceRecord(
  resourceId: ResourceId,
  input: UpdateServiceInput,
): Promise<ServiceResourceRow | undefined> {
  // Identity / ownership / placement columns are never patched through this
  // path — strip them out, then drop undefined so only explicitly-provided
  // spec fields land in the SET list (every remaining key maps 1:1 to a
  // serviceResource column).
  const {
    status: _status,
    source: _source,
    sourceSubdir: _sourceSubdir,
    internalHostname: _internalHostname,
    serviceName: _serviceName,
    networkName: _networkName,
    stackId: _stackId,
    ...spec
  } = input;
  const [updated] = await db
    .update(serviceResource)
    .set({
      ...omitUndefined(spec),
      // An explicit replica count supersedes a pause: whoever sets replicas
      // (manifest apply, a scaling edit) is stating the desired state, so the
      // pause marker must not linger and misreport "paused" afterwards.
      ...(spec.replicas !== undefined ? { pausedReplicas: null } : {}),
    })
    .where(eq(serviceResource.resourceId, resourceId))
    .returning();
  return updated;
}

export async function updateServiceResourceStatus(
  resourceId: ResourceId,
  status: "draft" | "valid" | "invalid",
) {
  const [updated] = await db
    .update(resource)
    .set({ status, updatedAt: new Date() })
    .where(eq(resource.id, resourceId))
    .returning();
  return updated;
}

export async function bumpForceUpdateCounter(resourceId: ResourceId): Promise<number | undefined> {
  const [updated] = await db
    .update(serviceResource)
    .set({ forceUpdateCounter: sql`${serviceResource.forceUpdateCounter} + 1` })
    .where(eq(serviceResource.resourceId, resourceId))
    .returning({ forceUpdateCounter: serviceResource.forceUpdateCounter });
  return updated?.forceUpdateCounter;
}

/**
 * Atomically flip the pause state: pause writes (replicas: 0, pausedReplicas:
 * previous count); resume writes (replicas: restored count, pausedReplicas:
 * null). Kept separate from `updateServiceRecord` — pausedReplicas is runtime
 * lifecycle state, not part of the patchable spec surface.
 */
export async function setServiceReplicaState(
  resourceId: ResourceId,
  input: { replicas: number; pausedReplicas: number | null },
): Promise<ServiceResourceRow | undefined> {
  const [updated] = await db
    .update(serviceResource)
    .set({ replicas: input.replicas, pausedReplicas: input.pausedReplicas })
    .where(eq(serviceResource.resourceId, resourceId))
    .returning();
  return updated;
}

export async function setPublicExposure(input: {
  resourceId: ResourceId;
  enabled: boolean;
  publicDomain: string | null;
}) {
  const [updated] = await db
    .update(serviceResource)
    .set({ publicEnabled: input.enabled, publicDomain: input.publicDomain })
    .where(eq(serviceResource.resourceId, input.resourceId))
    .returning();
  return updated;
}

/** Update only the denormalized primary-domain mirror, leaving the
 *  publicEnabled toggle untouched. Used when the operator picks a new
 *  primary among several hosts — the set of routes (and thus reachability)
 *  doesn't change, just which host the panel/graph/views surface. */
export async function setServicePublicDomain(resourceId: ResourceId, publicDomain: string | null) {
  const [updated] = await db
    .update(serviceResource)
    .set({ publicDomain })
    .where(eq(serviceResource.resourceId, resourceId))
    .returning();
  return updated;
}

export async function deleteServiceRecord(resourceId: ResourceId): Promise<void> {
  await db.delete(resource).where(eq(resource.id, resourceId));
}
