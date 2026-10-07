import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  composeResource,
  databaseResource,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { and, eq, isNull } from "drizzle-orm";

import { pruneSchedulesForDeletedResource } from "../../../backups/schedule-cleanup";
import { removeResourceDir } from "../../../lib/data-dir";
import { composeSwarmServiceName } from "../../../stack/compose";
import { inEnvironmentScope, type ResourceScope } from "./environment-scope";

export {
  inEnvironmentScope,
  resolveEnvironmentScope,
  resolveProjectEnvironmentScope,
  type EnvironmentScopeInput,
  type ResourceScope,
} from "./environment-scope";

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
 * Every resource attached to a project, within one environment scope. Returns
 * the parent `resource` row plus its type-specific extension joined. New `type`
 * discriminators must be added here when their tables ship.
 */
export async function listProjectResources(projectId: ProjectId, environmentScope: ResourceScope) {
  // Base + one environment: preview-scoped rows (opt-in DB branches) belong to
  // their PR preview, not the project graph / resource lists.
  const scope = and(
    eq(resource.projectId, projectId),
    isNull(resource.previewId),
    inEnvironmentScope(environmentScope),
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
 * The swarm service names a compose stack fans out to: one `${stack}-${key}`
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
  // Capture the org/project/env + name before the row is gone: the artifact
  // dir mirrors the DB hierarchy
  // (`orgs/<org>/projects/<prj>/envs/<env|main>/resources/<res>`), and the
  // name/org drive backup-schedule cleanup below.
  const [row] = await db
    .select({
      projectId: resource.projectId,
      environmentId: resource.environmentId,
      name: resource.name,
      organizationId: project.organizationId,
    })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(resource.id, resourceId))
    .limit(1);
  await db.delete(resource).where(eq(resource.id, resourceId));
  // The project row's org id is a plain string in the schema: narrow it with a
  // real runtime check (ids are minted as `org_…`) instead of an assertion. A
  // malformed id can't address either the host dir or the org's schedules, so
  // both cleanups are skipped rather than aimed at a bogus path.
  if (row && hasPrefix(row.organizationId, ID_PREFIX.organization)) {
    // Drop the resource's host artifact dir (no-op unless the data folder is in
    // use). Best-effort: never blocks the row delete. See lib/data-dir.ts.
    // `environmentId: null` means the project's main environment.
    await removeResourceDir({
      organizationId: row.organizationId,
      projectId: row.projectId,
      environmentId: row.environmentId ?? null,
      resourceId,
    });
    // Prune this now-deleted resource from any backup schedule that referenced
    // it (FK-less jsonb `sources`), disabling schedules left with no live
    // source. Runs AFTER the delete so the live set is accurate; never throws.
    await pruneSchedulesForDeletedResource({
      organizationId: row.organizationId,
      resourceId,
      resourceName: row.name,
    });
  }
}
