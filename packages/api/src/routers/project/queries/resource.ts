import type { EnvironmentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  composeResource,
  databaseResource,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { and, eq, isNull } from "drizzle-orm";

import { pruneSchedulesForDeletedResource } from "../../../backups/schedule-cleanup";
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
 * Rows owned by one environment scope.
 *
 * A NULL `environment_id` means the project's MAIN environment — main is
 * represented as base so existing names never change (see
 * lib/environment/scoping.ts). So "no environment selected" and "the main
 * environment" are deliberately the same query, and passing null/undefined here
 * is the pre-environment behaviour verbatim.
 *
 * This is what stops staging's resources appearing in production's graph and
 * vice versa. Without it every environment renders every environment's
 * resources — the symptom that started this work.
 */
export function inEnvironmentScope(environmentId: EnvironmentId | null | undefined) {
  return environmentId ? eq(resource.environmentId, environmentId) : isNull(resource.environmentId);
}

/**
 * Every resource attached to a project, within one environment scope. Returns
 * the parent `resource` row plus its type-specific extension joined. New `type`
 * discriminators must be added here when their tables ship.
 *
 * Omitting `environmentId` selects the main environment, which is what every
 * pre-environment caller wants and gets without changing.
 */
export async function listProjectResources(
  projectId: ProjectId,
  environmentId?: EnvironmentId | null,
) {
  // Base + one environment: preview-scoped rows (opt-in DB branches) belong to
  // their PR preview, not the project graph / resource lists.
  const scope = and(
    eq(resource.projectId, projectId),
    isNull(resource.previewId),
    inEnvironmentScope(environmentId),
  );

  const databases = await db
    .select({ resource, database: databaseResource })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(scope);

  const services = await db
    .select({ resource, service: serviceResource })
    .from(resource)
    .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .where(scope);

  const composes = await db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(scope);

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
  // Capture the project + name + org before the row is gone — the artifact dir
  // is nested under the project (`resources/<projectId>/<resourceId>`), and the
  // name/org drive backup-schedule cleanup below.
  const [row] = await db
    .select({
      projectId: resource.projectId,
      name: resource.name,
      organizationId: project.organizationId,
    })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(resource.id, resourceId))
    .limit(1);
  await db.delete(resource).where(eq(resource.id, resourceId));
  if (row) {
    // Drop the resource's host artifact dir (no-op unless the data folder is in
    // use). Best-effort — never blocks the row delete. See lib/data-dir.ts.
    await removeResourceDir(row.projectId, resourceId);
    // Prune this now-deleted resource from any backup schedule that referenced
    // it (FK-less jsonb `sources`), disabling schedules left with no live
    // source. Runs AFTER the delete so the live set is accurate; never throws.
    await pruneSchedulesForDeletedResource({
      organizationId: row.organizationId as OrganizationId,
      resourceId,
      resourceName: row.name,
    });
  }
}
