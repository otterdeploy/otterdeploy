import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { environment, project } from "@otterdeploy/db/schema/project";
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

/**
 * Atomic env delete that first null-outs any project pointing at this env
 * via `project.environmentId` (soft pointer, no DB FK). Without this, the
 * project row would carry a dangling id after delete.
 */
export async function deleteEnvRecord(input: {
  environmentId: EnvironmentId;
  organizationId: OrgId;
}): Promise<{ id: EnvironmentId } | undefined> {
  const owned = await getEnvInOrg(input);
  if (!owned) return undefined;

  return db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({ environmentId: null })
      .where(eq(project.environmentId, input.environmentId));

    const [deleted] = await tx
      .delete(environment)
      .where(eq(environment.id, input.environmentId))
      .returning({ id: environment.id });
    return deleted;
  });
}
