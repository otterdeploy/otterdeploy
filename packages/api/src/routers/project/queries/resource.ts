import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  composeResource,
  databaseResource,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { and, eq, isNull } from "drizzle-orm";

import { removeResourceDir } from "../../../lib/data-dir";
import { composeSwarmServiceName } from "../../../stack/compose";

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
  // Base resources only: preview-scoped rows (opt-in DB branches) belong to
  // their PR preview, not the project graph / resource lists.
  const databases = await db
    .select({ resource, database: databaseResource })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), isNull(resource.previewId)));

  const services = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), isNull(resource.previewId)));

  const composes = await db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), isNull(resource.previewId)));

  return { databases, services, composes };
}

export async function getResourceById(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<
  | { kind: "database"; record: DatabaseResourceJoined }
  | { kind: "service"; record: ServiceResourceJoined }
  | { kind: "compose"; record: ComposeResourceJoined }
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

  const [compRow] = await db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.id, resourceId)))
    .limit(1);

  if (compRow) return { kind: "compose", record: compRow };
  return null;
}

/**
 * The swarm service names a compose stack fans out to — one `${stack}-${key}`
 * per compose service, paired with the compose key so task/log views can
 * attribute output back to the sub-service. Runtime views (tasks, deployment
 * logs) aggregate across these; the stack has no swarm service of its own.
 */
export function composeChildSwarmServices(
  record: ComposeResourceJoined,
): Array<{ service: string; serviceName: string }> {
  return record.compose.services.map((s) => ({
    service: s.name,
    serviceName: composeSwarmServiceName(record.compose.stackName, s.name),
  }));
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
