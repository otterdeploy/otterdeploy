import { and, eq } from "drizzle-orm";

import { db } from "@otterstack/db";
import { databaseResource, resource } from "@otterstack/db/schema/project";

import type { ProjectId } from "../errors";
import type { ResourceId } from "../../service/errors";

export type DatabaseResourceJoined = {
  resource: typeof resource.$inferSelect;
  database: typeof databaseResource.$inferSelect;
};

/**
 * Fetch every resource attached to a project. Returns the parent `resource`
 * row plus its type-specific extension joined. New `type` discriminators must
 * be added here when their tables ship.
 */
export async function listProjectResources(projectId: ProjectId) {
  const databases = await db
    .select({ resource, database: databaseResource })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(eq(resource.projectId, projectId));

  return { databases };
}

export async function getResourceById(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<{ kind: "database"; record: DatabaseResourceJoined } | null> {
  const [dbRow] = await db
    .select({ resource, database: databaseResource })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.id, resourceId)))
    .limit(1);

  if (dbRow) return { kind: "database", record: dbRow };
  return null;
}

export async function deleteResourceById(resourceId: ResourceId) {
  await db.delete(resource).where(eq(resource.id, resourceId));
}
