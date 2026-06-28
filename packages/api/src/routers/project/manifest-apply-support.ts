/**
 * Small shared helpers for the manifest reconciler: grouping the diff plan by
 * resource kind, and resolving a service/database name to its resource id.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

import { type Change } from "../../stack/manifest";

export interface GroupedChanges {
  serviceCreates: Change[];
  serviceUpdates: Change[];
  serviceDeletes: Change[];
  databaseCreates: Change[];
  databaseUpdates: Change[];
  databaseDeletes: Change[];
  composeCreates: Change[];
}

export function groupChanges(changes: Change[]): GroupedChanges {
  const out: GroupedChanges = {
    serviceCreates: [],
    serviceUpdates: [],
    serviceDeletes: [],
    databaseCreates: [],
    databaseUpdates: [],
    databaseDeletes: [],
    composeCreates: [],
  };
  for (const c of changes) {
    if (c.kind === "no-op") continue;
    if (c.resource === "service") {
      if (c.kind === "create") out.serviceCreates.push(c);
      else if (c.kind === "update") out.serviceUpdates.push(c);
      else if (c.kind === "delete") out.serviceDeletes.push(c);
    } else if (c.resource === "database") {
      if (c.kind === "create") out.databaseCreates.push(c);
      else if (c.kind === "update") out.databaseUpdates.push(c);
      else if (c.kind === "delete") out.databaseDeletes.push(c);
    } else if (c.resource === "compose") {
      // diffComposes only ever emits create (or no-op, skipped above).
      if (c.kind === "create") out.composeCreates.push(c);
    }
    // env changes are handled per-service inside resolveEnv → bulkSetEnv;
    // we don't need to track them at the orchestrator level.
  }
  return out;
}

export async function lookupServiceId(
  projectId: ProjectId,
  name: string,
): Promise<ResourceId | null> {
  const [row] = await db
    .select({ id: serviceResource.resourceId })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .where(and(eq(resource.projectId, projectId), eq(resource.name, name)))
    .limit(1);
  return row?.id ?? null;
}

export async function lookupDatabaseId(
  projectId: ProjectId,
  name: string,
): Promise<ResourceId | null> {
  const [row] = await db
    .select({ id: databaseResource.resourceId })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .where(and(eq(resource.projectId, projectId), eq(resource.name, name)))
    .limit(1);
  return row?.id ?? null;
}
