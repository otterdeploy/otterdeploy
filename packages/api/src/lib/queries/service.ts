import { and, eq, inArray, like, sql } from "drizzle-orm";

import { db } from "@otterstack/db";
import {
  resource,
  serviceEnvVar,
  servicePort,
  serviceResource,
} from "@otterstack/db/schema/project";

export type ResourceRow = typeof resource.$inferSelect;
export type ServiceResourceRow = typeof serviceResource.$inferSelect;
export type ServicePortRow = typeof servicePort.$inferSelect;
export type ServiceEnvVarRow = typeof serviceEnvVar.$inferSelect;

export type ServiceRecord = {
  resource: ResourceRow;
  service: ServiceResourceRow;
  ports: ServicePortRow[];
  env: ServiceEnvVarRow[];
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getServiceRecord(
  projectId: string,
  resourceId: string,
): Promise<ServiceRecord | undefined> {
  const [row] = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.id, resourceId)))
    .limit(1);

  if (!row) return undefined;

  const [ports, env] = await Promise.all([
    listServicePorts(row.service.resourceId),
    listServiceEnvVars(row.service.resourceId),
  ]);

  return { resource: row.resource, service: row.service, ports, env };
}

export async function getServiceRecordByName(
  projectId: string,
  name: string,
): Promise<ServiceRecord | undefined> {
  const [row] = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.name, name)))
    .limit(1);

  if (!row) return undefined;

  const [ports, env] = await Promise.all([
    listServicePorts(row.service.resourceId),
    listServiceEnvVars(row.service.resourceId),
  ]);

  return { resource: row.resource, service: row.service, ports, env };
}

export async function listServiceRecordsByProject(
  projectId: string,
): Promise<ServiceRecord[]> {
  const rows = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(eq(resource.projectId, projectId));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.service.resourceId);
  const [allPorts, allEnv] = await Promise.all([
    db.select().from(servicePort).where(inArray(servicePort.serviceResourceId, ids)),
    db.select().from(serviceEnvVar).where(inArray(serviceEnvVar.serviceResourceId, ids)),
  ]);

  return rows.map((row) => ({
    resource: row.resource,
    service: row.service,
    ports: allPorts.filter((p) => p.serviceResourceId === row.service.resourceId),
    env: allEnv.filter((e) => e.serviceResourceId === row.service.resourceId),
  }));
}

export async function listServicePorts(
  serviceResourceId: string,
): Promise<ServicePortRow[]> {
  return db
    .select()
    .from(servicePort)
    .where(eq(servicePort.serviceResourceId, serviceResourceId));
}

export async function listServiceEnvVars(
  serviceResourceId: string,
): Promise<ServiceEnvVarRow[]> {
  return db
    .select()
    .from(serviceEnvVar)
    .where(eq(serviceEnvVar.serviceResourceId, serviceResourceId));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CreateServiceInput = {
  projectId: string;
  name: string;
  status?: "draft" | "valid" | "invalid";

  image: string;
  command?: string[] | null;
  entrypoint?: string[] | null;
  replicas?: number;

  restartCondition?: "none" | "on-failure" | "any";
  restartMaxAttempts?: number | null;
  restartDelayMs?: number;

  healthcheckCmd?: string[] | null;
  healthcheckIntervalMs?: number | null;
  healthcheckTimeoutMs?: number | null;
  healthcheckRetries?: number | null;
  healthcheckStartMs?: number | null;

  cpuLimit?: string | null;
  memoryLimitMb?: number | null;
  cpuReservation?: string | null;
  memoryReservationMb?: number | null;

  internalHostname: string;
  serviceName: string;
  networkName: string;

  ports: Array<{
    containerPort: number;
    protocol?: "tcp" | "udp";
    appProtocol?: "http" | "tcp";
    isPrimary?: boolean;
  }>;

  env?: Array<{ key: string; value: string }>;
};

export async function createServiceRecord(
  input: CreateServiceInput,
): Promise<ServiceRecord> {
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
      throw new Error("Failed to create service resource row.");
    }

    const [createdService] = await tx
      .insert(serviceResource)
      .values({
        resourceId: createdResource.id,
        image: input.image,
        command: input.command ?? null,
        entrypoint: input.entrypoint ?? null,
        replicas: input.replicas ?? 1,

        restartCondition: input.restartCondition ?? "on-failure",
        restartMaxAttempts: input.restartMaxAttempts ?? null,
        restartDelayMs: input.restartDelayMs ?? 5000,

        healthcheckCmd: input.healthcheckCmd ?? null,
        healthcheckIntervalMs: input.healthcheckIntervalMs ?? null,
        healthcheckTimeoutMs: input.healthcheckTimeoutMs ?? null,
        healthcheckRetries: input.healthcheckRetries ?? null,
        healthcheckStartMs: input.healthcheckStartMs ?? null,

        cpuLimit: input.cpuLimit ?? null,
        memoryLimitMb: input.memoryLimitMb ?? null,
        cpuReservation: input.cpuReservation ?? null,
        memoryReservationMb: input.memoryReservationMb ?? null,

        internalHostname: input.internalHostname,
        serviceName: input.serviceName,
        networkName: input.networkName,
      })
      .returning();

    if (!createdService) {
      throw new Error("Failed to create service_resource sidecar row.");
    }

    const ports = input.ports.length === 0
      ? []
      : await tx
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

    const env = !input.env || input.env.length === 0
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
    };
  });
}

export type UpdateServiceInput = Partial<
  Omit<CreateServiceInput, "projectId" | "name" | "ports" | "env">
> & {
  imageDigest?: string | null;
};

export async function updateServiceRecord(
  resourceId: string,
  input: UpdateServiceInput,
): Promise<ServiceResourceRow | undefined> {
  const [updated] = await db
    .update(serviceResource)
    .set({
      ...(input.image !== undefined ? { image: input.image } : {}),
      ...(input.imageDigest !== undefined ? { imageDigest: input.imageDigest } : {}),
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.entrypoint !== undefined ? { entrypoint: input.entrypoint } : {}),
      ...(input.replicas !== undefined ? { replicas: input.replicas } : {}),
      ...(input.restartCondition !== undefined ? { restartCondition: input.restartCondition } : {}),
      ...(input.restartMaxAttempts !== undefined ? { restartMaxAttempts: input.restartMaxAttempts } : {}),
      ...(input.restartDelayMs !== undefined ? { restartDelayMs: input.restartDelayMs } : {}),
      ...(input.healthcheckCmd !== undefined ? { healthcheckCmd: input.healthcheckCmd } : {}),
      ...(input.healthcheckIntervalMs !== undefined ? { healthcheckIntervalMs: input.healthcheckIntervalMs } : {}),
      ...(input.healthcheckTimeoutMs !== undefined ? { healthcheckTimeoutMs: input.healthcheckTimeoutMs } : {}),
      ...(input.healthcheckRetries !== undefined ? { healthcheckRetries: input.healthcheckRetries } : {}),
      ...(input.healthcheckStartMs !== undefined ? { healthcheckStartMs: input.healthcheckStartMs } : {}),
      ...(input.cpuLimit !== undefined ? { cpuLimit: input.cpuLimit } : {}),
      ...(input.memoryLimitMb !== undefined ? { memoryLimitMb: input.memoryLimitMb } : {}),
      ...(input.cpuReservation !== undefined ? { cpuReservation: input.cpuReservation } : {}),
      ...(input.memoryReservationMb !== undefined ? { memoryReservationMb: input.memoryReservationMb } : {}),
    })
    .where(eq(serviceResource.resourceId, resourceId))
    .returning();

  return updated;
}

export async function updateServiceResourceStatus(
  resourceId: string,
  status: "draft" | "valid" | "invalid",
) {
  const [updated] = await db
    .update(resource)
    .set({ status, updatedAt: new Date() })
    .where(eq(resource.id, resourceId))
    .returning();

  return updated;
}

export async function bumpForceUpdateCounter(
  resourceId: string,
): Promise<number | undefined> {
  const [updated] = await db
    .update(serviceResource)
    .set({
      forceUpdateCounter: sql`${serviceResource.forceUpdateCounter} + 1`,
    })
    .where(eq(serviceResource.resourceId, resourceId))
    .returning({ forceUpdateCounter: serviceResource.forceUpdateCounter });

  return updated?.forceUpdateCounter;
}

export async function setPublicExposure(input: {
  resourceId: string;
  enabled: boolean;
  publicDomain: string | null;
}) {
  const [updated] = await db
    .update(serviceResource)
    .set({
      publicEnabled: input.enabled,
      publicDomain: input.publicDomain,
    })
    .where(eq(serviceResource.resourceId, input.resourceId))
    .returning();

  return updated;
}

export async function deleteServiceRecord(resourceId: string): Promise<void> {
  await db.delete(resource).where(eq(resource.id, resourceId));
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export async function replaceServicePorts(
  serviceResourceId: string,
  ports: CreateServiceInput["ports"],
): Promise<ServicePortRow[]> {
  return db.transaction(async (tx) => {
    await tx
      .delete(servicePort)
      .where(eq(servicePort.serviceResourceId, serviceResourceId));

    if (ports.length === 0) return [];

    return tx
      .insert(servicePort)
      .values(
        ports.map((p) => ({
          serviceResourceId,
          containerPort: p.containerPort,
          protocol: p.protocol ?? "tcp",
          appProtocol: p.appProtocol ?? "http",
          isPrimary: p.isPrimary ?? false,
        })),
      )
      .returning();
  });
}

export function getPrimaryHttpPort(
  ports: ServicePortRow[],
): ServicePortRow | undefined {
  return (
    ports.find((p) => p.isPrimary && p.appProtocol === "http") ??
    ports.find((p) => p.appProtocol === "http")
  );
}

// ---------------------------------------------------------------------------
// Env vars
// ---------------------------------------------------------------------------

export async function upsertServiceEnvVar(input: {
  serviceResourceId: string;
  key: string;
  value: string;
}): Promise<ServiceEnvVarRow> {
  const [row] = await db
    .insert(serviceEnvVar)
    .values(input)
    .onConflictDoUpdate({
      target: [serviceEnvVar.serviceResourceId, serviceEnvVar.key],
      set: { value: input.value, updatedAt: new Date() },
    })
    .returning();

  if (!row) throw new Error("Failed to upsert env var.");
  return row;
}

export async function deleteServiceEnvVar(input: {
  serviceResourceId: string;
  key: string;
}): Promise<boolean> {
  const result = await db
    .delete(serviceEnvVar)
    .where(
      and(
        eq(serviceEnvVar.serviceResourceId, input.serviceResourceId),
        eq(serviceEnvVar.key, input.key),
      ),
    )
    .returning({ id: serviceEnvVar.id });
  return result.length > 0;
}

export async function bulkReplaceServiceEnvVars(
  serviceResourceId: string,
  vars: Array<{ key: string; value: string }>,
): Promise<ServiceEnvVarRow[]> {
  return db.transaction(async (tx) => {
    await tx
      .delete(serviceEnvVar)
      .where(eq(serviceEnvVar.serviceResourceId, serviceResourceId));

    if (vars.length === 0) return [];

    return tx
      .insert(serviceEnvVar)
      .values(
        vars.map((v) => ({
          serviceResourceId,
          key: v.key,
          value: v.value,
        })),
      )
      .returning();
  });
}

// ---------------------------------------------------------------------------
// Cross-resource lookups for the variable resolver
// ---------------------------------------------------------------------------

export async function getResourceByProjectAndName(
  projectId: string,
  name: string,
): Promise<ResourceRow | undefined> {
  const [row] = await db
    .select()
    .from(resource)
    .where(and(eq(resource.projectId, projectId), eq(resource.name, name)))
    .limit(1);
  return row;
}

/**
 * Find services in `projectId` whose env-var values literally reference
 * `${{<targetResourceName>.…}}`. Returns service resource IDs.
 *
 * This is a best-effort SQL `LIKE` scan; the resolver re-parses each candidate
 * to confirm and to skip escaped tokens (`\${{…}}`).
 */
export async function findServiceDependentsByName(input: {
  projectId: string;
  targetResourceName: string;
}): Promise<string[]> {
  const pattern = `%\${{${input.targetResourceName}.%`;
  const rows = await db
    .select({ serviceResourceId: serviceEnvVar.serviceResourceId })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    .where(
      and(
        eq(resource.projectId, input.projectId),
        like(serviceEnvVar.value, pattern),
      ),
    );

  // Dedupe — a service can reference the target via multiple env vars.
  return Array.from(new Set(rows.map((r) => r.serviceResourceId)));
}

