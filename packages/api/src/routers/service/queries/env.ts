import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import { and, eq, like } from "drizzle-orm";
import { createError } from "evlog";

import { db } from "@otterdeploy/db";
import {
  resource,
  serviceEnvVar,
} from "@otterdeploy/db/schema/project";

import type { ResourceRow, ServiceEnvVarRow } from ".";
// ---------------------------------------------------------------------------
// Env vars
// ---------------------------------------------------------------------------

export async function listServiceEnvVars(
  serviceResourceId: ResourceId,
): Promise<ServiceEnvVarRow[]> {
  return db
    .select()
    .from(serviceEnvVar)
    .where(eq(serviceEnvVar.serviceResourceId, serviceResourceId));
}

export async function upsertServiceEnvVar(input: {
  serviceResourceId: ResourceId;
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

  if (!row) {
    throw createError({
      message: "Failed to upsert env var",
      status: 500,
      why: "Database upsert returned no row",
    });
  }
  return row;
}

export async function deleteServiceEnvVar(input: {
  serviceResourceId: ResourceId;
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
  serviceResourceId: ResourceId,
  vars: Array<{ key: string; value: string; isSecret?: boolean }>,
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
          isSecret: v.isSecret ?? false,
        })),
      )
      .returning();
  });
}

// ---------------------------------------------------------------------------
// Cross-resource lookups for the variable resolver
// ---------------------------------------------------------------------------

export async function getResourceByProjectAndName(
  projectId: ProjectId,
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
 * Best-effort SQL `LIKE` scan; the resolver re-parses each candidate to
 * confirm and to skip escaped tokens (`\${{…}}`).
 */
export async function findServiceDependentsByName(input: {
  projectId: ProjectId;
  targetResourceName: string;
}): Promise<ResourceId[]> {
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
  return Array.from(new Set(rows.map((r) => r.serviceResourceId))) as ResourceId[];
}
