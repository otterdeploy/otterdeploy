import { and, eq, like } from "drizzle-orm";

import { db } from "@otterstack/db";
import {
  resource,
  serviceEnvVar,
} from "@otterstack/db/schema/project";

import type { ResourceRow, ServiceEnvVarRow } from ".";

// ---------------------------------------------------------------------------
// Env vars
// ---------------------------------------------------------------------------

export async function listServiceEnvVars(
  serviceResourceId: string,
): Promise<ServiceEnvVarRow[]> {
  return db
    .select()
    .from(serviceEnvVar)
    .where(eq(serviceEnvVar.serviceResourceId, serviceResourceId));
}

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
 * Best-effort SQL `LIKE` scan; the resolver re-parses each candidate to
 * confirm and to skip escaped tokens (`\${{…}}`).
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
