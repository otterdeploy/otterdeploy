/**
 * Small shared helpers for the manifest reconciler: grouping the diff plan by
 * resource kind, and resolving a service/database name to its resource id.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import { type Change } from "../../stack/manifest";
import { inEnvironmentScope, type EnvironmentScopeInput } from "./queries/resource";

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
  // it: without this, an env-only plan applied ZERO of its N changes and the
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
/** The slice of an env change's `details` the synthesis below reads: which
 *  resource kind owns the env row, and that owner's manifest name. */
const envOwnerSchema = z.object({
  parent: z.string().optional(),
  owner: z.string().optional(),
});

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
    const details = envOwnerSchema.safeParse(c.details);
    if (!details.success || details.data.parent !== parent) continue;
    const owner = details.data.owner;
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

/**
 * The service this apply means by `name`, WITHIN its environment.
 *
 * The scope is not optional, and this is why: resource names are unique per
 * environment, not per project, so `api-prod` names one row in staging and a
 * different row in production. Matching on (project, name) alone returned
 * whichever of them the planner reached first - with no ORDER BY, whichever
 * Postgres felt like - and the apply then wrote the environment it had
 * resolved the manifest FOR onto a resource belonging to the other one.
 *
 * The failure is silent and symmetrical: staging's overrides land on
 * production, production's base values land on staging, and both environments
 * come back up serving each other's config. Observed in the wild as an API
 * answering on the production domain with the staging database URL, the
 * staging CORS list and the staging auth URL.
 *
 * `createOneService` never had this bug because creates carry
 * `environmentId` explicitly. Updates resolved by name, so only updates were
 * affected: the environment was known the whole time and simply not used.
 */
export async function lookupServiceId(
  projectId: ProjectId,
  name: string,
  scope: EnvironmentScopeInput,
): Promise<ResourceId | null> {
  const [row] = await db
    .select({ id: serviceResource.resourceId })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .where(
      and(eq(resource.projectId, projectId), eq(resource.name, name), inEnvironmentScope(scope)),
    )
    .limit(1);
  return row?.id ?? null;
}

/** The database this apply means by `name`, within its environment. Same
 *  reasoning as lookupServiceId above, and the same consequence: `postgres`
 *  exists in both environments and an unscoped match repoints the wrong one. */
export async function lookupDatabaseId(
  projectId: ProjectId,
  name: string,
  scope: EnvironmentScopeInput,
): Promise<ResourceId | null> {
  const [row] = await db
    .select({ id: databaseResource.resourceId })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .where(
      and(eq(resource.projectId, projectId), eq(resource.name, name), inEnvironmentScope(scope)),
    )
    .limit(1);
  return row?.id ?? null;
}
