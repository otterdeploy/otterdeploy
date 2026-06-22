import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import { and, eq } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import {
  composeResource,
  databaseResource,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";

import { removeResourceDir } from "../../../lib/data-dir";

export interface DatabaseResourceJoined {
  resource: typeof resource.$inferSelect;
  database: typeof databaseResource.$inferSelect;
}

export interface ServiceResourceJoined {
  resource: typeof resource.$inferSelect;
  service: typeof serviceResource.$inferSelect;
}

export interface ComposeResourceJoined {
  resource: typeof resource.$inferSelect;
  compose: typeof composeResource.$inferSelect;
}

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

  const services = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(eq(resource.projectId, projectId));

  const composes = await db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(eq(resource.projectId, projectId));

  return { databases, services, composes };
}

export async function getResourceById(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<
  | { kind: "database"; record: DatabaseResourceJoined }
  | { kind: "service"; record: ServiceResourceJoined }
  | null
> {
  const [dbRow] = await db
    .select({ resource, database: databaseResource })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.id, resourceId)))
    .limit(1);

  if (dbRow) return { kind: "database", record: dbRow };

  const [svcRow] = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.id, resourceId)))
    .limit(1);

  if (svcRow) return { kind: "service", record: svcRow };
  return null;
}

export async function deleteResourceById(resourceId: ResourceId) {
  // Capture the project before the row is gone — the artifact dir is nested
  // under it (`resources/<projectId>/<resourceId>`).
  const [row] = await db
    .select({ projectId: resource.projectId })
    .from(resource)
    .where(eq(resource.id, resourceId))
    .limit(1);
  await db.delete(resource).where(eq(resource.id, resourceId));
  // Drop the resource's host artifact dir (no-op unless the data folder is in
  // use). Best-effort — never blocks the row delete. See lib/data-dir.ts.
  if (row) await removeResourceDir(row.projectId, resourceId);
}
