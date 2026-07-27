/**
 * Org-wide aggregate reads that back the project-list CARDS — the per-project
 * resource/route tallies and the service-resource refs the "running" count is
 * computed against.
 *
 * Split out of `./project.ts` because they are a different shape of query from
 * everything else in that file: `project.ts` owns row-level project/environment
 * CRUD (one project in, one project out), while these three are org-scoped
 * GROUP BY scans whose `.from()` is deliberately NOT `project` (see the note on
 * {@link countResourcesByProject} for why that distinction is load-bearing and
 * not cosmetic). Keeping them together also keeps the "running ⊆ total"
 * invariant the three of them jointly maintain readable in one place.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * Per-project resource tallies for the project cards, as one grouped scan of
 * `resource` — NOT correlated subqueries hung off the project select. Drizzle
 * only table-qualifies columns when the outer query has a join, so
 * `sql\`(select count(*) from ${resource} where ${resource.projectId} = ${project.id})\``
 * rendered as `where "project_id" = "id"`; inside the subquery both names bind
 * to `resource`'s own columns, so it asked for `resource.project_id =
 * resource.id` and every card counted 0. Grouping keeps each count in a query
 * whose `.from()` is the table it actually reads, which also lets the global
 * cache tag and invalidate it on a resource write.
 *
 * `serviceCount` MUST cover the same universe the running tally does —
 * `countRunningServicesByProject` matches live containers across service AND
 * compose resources — otherwise a project whose workloads are compose stacks
 * shows more running than total (a `type='service'`-only count renders `5/0`:
 * the stack's containers count as running, but its `compose` resource isn't in
 * the denominator). Counting `service` + `compose` keeps running ⊆ total.
 */
export async function countResourcesByProject(organizationId: OrganizationId) {
  const rows = await db
    .select({
      projectId: resource.projectId,
      databaseCount: sql<number>`count(*) filter (where ${resource.type} = 'database')::int`,
      serviceCount: sql<number>`count(*) filter (where ${resource.type} in ('service', 'compose'))::int`,
    })
    .from(resource)
    .innerJoin(project, eq(resource.projectId, project.id))
    .where(eq(project.organizationId, organizationId))
    .groupBy(resource.projectId);
  return new Map(rows.map((r) => [r.projectId, r]));
}

/**
 * Per-project count of *enabled* proxy routes — disabled/custom-pending routes
 * never reach the edge, so they don't belong in the card's tally. Grouped for
 * the same reasons as {@link countResourcesByProject}.
 */
export async function countEnabledRoutesByProject(organizationId: OrganizationId) {
  const rows = await db
    .select({
      projectId: proxyRoute.projectId,
      routeCount: sql<number>`count(*)::int`,
    })
    .from(proxyRoute)
    .innerJoin(project, eq(proxyRoute.projectId, project.id))
    .where(and(eq(project.organizationId, organizationId), eq(proxyRoute.enabled, true)))
    .groupBy(proxyRoute.projectId);
  return new Map(rows.map((r) => [r.projectId, r.routeCount]));
}

/**
 * `(id, projectId)` for every service/compose resource in the org. The project
 * list's "running" tally is computed against these ids: a resource counts as
 * running when at least one managed container carries its
 * `otterdeploy.resource.id` label (see `listProjects`).
 */
export async function listServiceResourceRefsByOrg(organizationId: OrganizationId) {
  return db
    .select({ id: resource.id, projectId: resource.projectId })
    .from(resource)
    .innerJoin(project, eq(resource.projectId, project.id))
    .where(
      and(
        eq(project.organizationId, organizationId),
        inArray(resource.type, ["service", "compose"]),
      ),
    );
}
