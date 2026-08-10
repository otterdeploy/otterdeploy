import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  composeResource,
  databaseResource,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { and, eq, isNull, or } from "drizzle-orm";

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
 * A NULL `environment_id` means the project's MAIN environment. Resources
 * pre-date environment scoping and were all created unstamped, so main has to
 * own them or they'd be invisible everywhere — but that equivalence holds ONLY
 * for main, which is why `isMain` is a required argument rather than something
 * inferred from `environmentId` being absent.
 *
 * That inference is exactly what was wrong before: this took a lone optional
 * `environmentId` and treated "not supplied" as "the main environment", so
 * every caller that simply forgot to pass one silently got the `IS NULL` scope
 * and looked like it was working. Making both facts explicit means a caller
 * cannot express "some environment, I don't know which".
 *
 * This is what stops staging's resources appearing in production's graph and
 * vice versa. Without it every environment renders every environment's
 * resources — the symptom that started this work.
 */
export function inEnvironmentScope(scope: ResourceScope) {
  // Reverse lookups (container name → resource) must span environments or a
  // staging container's logs resolve to nothing. Spelled as a literal rather
  // than an omitted argument so it reads as a decision at the call site.
  if (scope === "all") return undefined;
  const owned = eq(resource.environmentId, scope.environmentId);
  // Main additionally owns every unstamped row; a non-main environment owns
  // only what explicitly names it.
  return scope.isMain ? or(owned, isNull(resource.environmentId)) : owned;
}

/**
 * Which environment a read is scoped to. `isMain` is the project's own
 * `environment_id` pointer matching this environment — see resolveEnvironmentScope.
 */
export interface EnvironmentScopeInput {
  environmentId: EnvironmentId;
  isMain: boolean;
}

/**
 * One environment, or deliberately every one of them. `"all"` is for reverse
 * lookups that map a container/service NAME back to a resource — those must see
 * every environment or a non-main container resolves to nothing. It is never
 * correct for a list the operator is looking at.
 */
export type ResourceScope = EnvironmentScopeInput | "all";

/**
 * Turn "this project, maybe this environment" into a scope.
 *
 * Callers hold a project row and an OPTIONAL environment id (the client sends
 * one once the operator has picked from the switcher; deep links, internal
 * callers and the CLI often don't). Absent means the project's main
 * environment — the same thing the UI defaults to — so every caller lands on a
 * real environment id rather than the old implicit `IS NULL`.
 *
 * Returns null only for a project with no `environment_id` pointer at all,
 * which project.create has always set; callers treat that as "no resources".
 */
export function resolveEnvironmentScope(
  projectRow: { environmentId: EnvironmentId | null },
  requested?: EnvironmentId | null,
): EnvironmentScopeInput | null {
  const main = projectRow.environmentId;
  if (!main) return null;
  const environmentId = requested ?? main;
  return { environmentId, isMain: environmentId === main };
}

/**
 * {@link resolveEnvironmentScope} for callers that hold only a projectId and
 * would otherwise re-query the project row by hand.
 */
export async function resolveProjectEnvironmentScope(
  projectId: ProjectId,
  requested?: EnvironmentId | null,
): Promise<EnvironmentScopeInput | null> {
  const [row] = await db
    .select({ environmentId: project.environmentId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  return row ? resolveEnvironmentScope(row, requested) : null;
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
  // Capture the org/project/env + name before the row is gone — the artifact
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
  // The project row's org id is a plain string in the schema — narrow it with a
  // real runtime check (ids are minted as `org_…`) instead of an assertion. A
  // malformed id can't address either the host dir or the org's schedules, so
  // both cleanups are skipped rather than aimed at a bogus path.
  if (row && hasPrefix(row.organizationId, ID_PREFIX.organization)) {
    // Drop the resource's host artifact dir (no-op unless the data folder is in
    // use). Best-effort — never blocks the row delete. See lib/data-dir.ts.
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
