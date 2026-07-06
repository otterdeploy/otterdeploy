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
  }

  // Env changes ride their OWNING resource's update phase (resolveEnv →
  // bulkSetEnv / applyPostgresExtraEnv). A resource whose diff is env-ONLY
  // emits no service/database change of its own, so synthesize an update for
  // it — without this, an env-only plan applied ZERO of its N changes and the
  // pending bar never cleared. `envOnly` lets the service phase skip the
  // field-patch call and go straight to the env reconcile.
  synthesizeEnvOnlyUpdates(
    changes,
    "service",
    out.serviceCreates,
    out.serviceUpdates,
    out.serviceDeletes,
  );
  synthesizeEnvOnlyUpdates(
    changes,
    "database",
    out.databaseCreates,
    out.databaseUpdates,
    out.databaseDeletes,
  );
  return out;
}

function synthesizeEnvOnlyUpdates(
  changes: Change[],
  parent: "service" | "database",
  creates: Change[],
  updates: Change[],
  deletes: Change[],
): void {
  const covered = new Set([...creates, ...updates, ...deletes].map((c) => c.name));
  for (const c of changes) {
    if (c.resource !== "env" || c.kind === "no-op") continue;
    const details = c.details as { parent?: string; owner?: string } | undefined;
    if (details?.parent !== parent) continue;
    const owner = details.owner;
    if (!owner || covered.has(owner)) continue;
    covered.add(owner);
    updates.push({
      kind: "update",
      resource: parent,
      name: owner,
      details: { envOnly: true },
    });
  }
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
