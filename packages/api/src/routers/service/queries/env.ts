import type { PreviewId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource, serviceEnvVar } from "@otterdeploy/db/schema/project";
import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import { createError } from "evlog";

import type { ResourceRow, ServiceEnvVarRow } from ".";
// ---------------------------------------------------------------------------
// Env vars
// ---------------------------------------------------------------------------

/** BASE rows only — preview overrides never surface in base env editors,
 *  views, refs or manifest state. The resolver overlays preview rows itself
 *  via listPreviewServiceEnvVars. */
export async function listServiceEnvVars(
  serviceResourceId: ResourceId,
): Promise<ServiceEnvVarRow[]> {
  return db
    .select()
    .from(serviceEnvVar)
    .where(
      and(eq(serviceEnvVar.serviceResourceId, serviceResourceId), isNull(serviceEnvVar.previewId)),
    );
}

/** A preview's override rows for one service. */
export async function listPreviewServiceEnvVars(
  serviceResourceId: ResourceId,
  previewId: PreviewId,
): Promise<ServiceEnvVarRow[]> {
  return db
    .select()
    .from(serviceEnvVar)
    .where(
      and(
        eq(serviceEnvVar.serviceResourceId, serviceResourceId),
        eq(serviceEnvVar.previewId, previewId),
      ),
    );
}

export async function upsertPreviewServiceEnvVar(input: {
  serviceResourceId: ResourceId;
  previewId: PreviewId;
  key: string;
  value: string;
}): Promise<ServiceEnvVarRow> {
  const [row] = await db
    .insert(serviceEnvVar)
    .values(input)
    .onConflictDoUpdate({
      target: [serviceEnvVar.serviceResourceId, serviceEnvVar.previewId, serviceEnvVar.key],
      targetWhere: sql`preview_id is not null`,
      set: { value: input.value, updatedAt: new Date() },
    })
    .returning();
  if (!row) {
    throw createError({
      message: "Failed to upsert preview env override",
      status: 500,
      why: "Database upsert returned no row",
    });
  }
  return row;
}

export async function deletePreviewServiceEnvVar(input: {
  serviceResourceId: ResourceId;
  previewId: PreviewId;
  key: string;
}): Promise<boolean> {
  const result = await db
    .delete(serviceEnvVar)
    .where(
      and(
        eq(serviceEnvVar.serviceResourceId, input.serviceResourceId),
        eq(serviceEnvVar.previewId, input.previewId),
        eq(serviceEnvVar.key, input.key),
      ),
    )
    .returning({ id: serviceEnvVar.id });
  return result.length > 0;
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
      targetWhere: sql`preview_id is null`,
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
        isNull(serviceEnvVar.previewId),
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
    // Base rows only — a bulk edit of the base env must never wipe a PR
    // preview's overrides.
    await tx
      .delete(serviceEnvVar)
      .where(
        and(
          eq(serviceEnvVar.serviceResourceId, serviceResourceId),
          isNull(serviceEnvVar.previewId),
        ),
      );

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
 * Preview-aware resource lookup for the variable resolver: a preview-scoped
 * row (an opt-in DB branch, `previewId = <preview>`) wins over the base row
 * (`previewId IS NULL`), which every non-preview resource is. Ordering NULLs
 * last puts the preview-scoped match first, so LIMIT 1 returns the branch when
 * present and the base otherwise. With no preview scope this always resolves
 * to the base row — identical to `getResourceByProjectAndName`.
 */
export async function resolveResourceForPreview(
  projectId: ProjectId,
  previewId: PreviewId | null,
  name: string,
): Promise<ResourceRow | undefined> {
  if (!previewId) {
    const [row] = await db
      .select()
      .from(resource)
      .where(
        and(
          eq(resource.projectId, projectId),
          eq(resource.name, name),
          isNull(resource.previewId),
        ),
      )
      .limit(1);
    return row;
  }
  const [row] = await db
    .select()
    .from(resource)
    .where(
      and(
        eq(resource.projectId, projectId),
        eq(resource.name, name),
        or(eq(resource.previewId, previewId), isNull(resource.previewId)),
      ),
    )
    .orderBy(sql`${resource.previewId} nulls last`)
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
        isNull(serviceEnvVar.previewId),
      ),
    );

  // Dedupe — a service can reference the target via multiple env vars.
  return Array.from(new Set(rows.map((r) => r.serviceResourceId))) as ResourceId[];
}
