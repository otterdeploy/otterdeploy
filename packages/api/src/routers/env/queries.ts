import type { EnvironmentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { environment, project, resource } from "@otterdeploy/db/schema/project";
import { and, asc, eq } from "drizzle-orm";
type OrgId = OrganizationId;

export type EnvironmentRecord = InferSelectModel<typeof environment>;

/**
 * Environments scoped to the active organization. Optionally filter by project.
 */
export async function listEnvsByOrg(
  organizationId: OrgId,
  projectId?: ProjectId,
): Promise<EnvironmentRecord[]> {
  const conditions = projectId
    ? and(eq(project.organizationId, organizationId), eq(environment.projectId, projectId))
    : eq(project.organizationId, organizationId);

  const rows = await db
    .select({ environment })
    .from(environment)
    .innerJoin(project, eq(project.id, environment.projectId))
    .where(conditions)
    .orderBy(asc(environment.createdAt));

  return rows.map((r) => r.environment);
}

export async function getEnvInOrg(input: {
  environmentId: EnvironmentId;
  organizationId: OrgId;
}): Promise<EnvironmentRecord | undefined> {
  const [row] = await db
    .select({ environment })
    .from(environment)
    .innerJoin(project, eq(project.id, environment.projectId))
    .where(
      and(
        eq(environment.id, input.environmentId),
        eq(project.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row?.environment;
}

/**
 * Inserts an env row. Pass `projectId` to attach immediately; omit it to
 * create a standalone env that `project.create` can claim later.
 */
export async function createEnvRecord(input: {
  id?: EnvironmentId;
  name: string;
  slug: string;
  projectId?: ProjectId;
}): Promise<EnvironmentRecord | undefined> {
  const [row] = await db.insert(environment).values(input).returning();
  return row;
}

/** Resources still owned by an environment. The caller needs these BEFORE the
 *  row is deleted. Afterwards there is no way to find them, because the id
 *  they carry no longer resolves to anything. */
async function listResourcesInEnvironment(
  environmentId: EnvironmentId,
): Promise<{ id: ResourceId; name: string; projectId: ProjectId }[]> {
  return db
    .select({ id: resource.id, name: resource.name, projectId: resource.projectId })
    .from(resource)
    .where(eq(resource.environmentId, environmentId));
}

/**
 * Atomic env delete that first null-outs any project pointing at this env
 * via `project.environmentId` (soft pointer, no DB FK). Without this, the
 * project row would carry a dangling id after delete.
 *
 * Resource rows carry the same soft pointer, and they are the dangerous one: a
 * resource left with a dangling `environment_id` matches NO scope query. It is
 * not base (its column is non-null) and its environment no longer exists, so it
 * vanishes from every list and graph while its container keeps running. The
 * delete therefore refuses unless the caller has explicitly accepted what
 * happens to them. `cascade` deletes the rows, and the caller is responsible
 * for having torn down their runtime first.
 */
export async function deleteEnvRecord(input: {
  environmentId: EnvironmentId;
  organizationId: OrgId;
  /** Delete resources owned by this environment along with it. Without this a
   *  non-empty environment is refused rather than orphaning its rows. */
  cascade?: boolean;
}): Promise<
  { ok: true; id: EnvironmentId } | { ok: false; reason: "not-found" | "has-resources" }
> {
  const owned = await getEnvInOrg(input);
  if (!owned) return { ok: false, reason: "not-found" };

  const ownedResources = await listResourcesInEnvironment(input.environmentId);
  if (ownedResources.length > 0 && !input.cascade) {
    return { ok: false, reason: "has-resources" };
  }

  return db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({ environmentId: null })
      .where(eq(project.environmentId, input.environmentId));

    // Ordered before the environment delete so no row is ever left pointing at
    // an id that has stopped existing, even if the transaction is inspected
    // mid-flight by another connection.
    if (ownedResources.length > 0) {
      await tx.delete(resource).where(eq(resource.environmentId, input.environmentId));
    }

    const [deleted] = await tx
      .delete(environment)
      .where(eq(environment.id, input.environmentId))
      .returning({ id: environment.id });
    return deleted
      ? ({ ok: true, id: deleted.id } as const)
      : ({ ok: false, reason: "not-found" } as const);
  });
}
