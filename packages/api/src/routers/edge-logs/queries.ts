import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, eq } from "drizzle-orm";

import { normalizeHost } from "../../edge-logs/host";

/** All domains owned by an org — the access-log/event visibility scope. NOT
 *  restricted to `type="http"`: the cross-tenant guard is the org join, and an
 *  org's layer4 (public-DB) domains still get cert/ACME events on the operational
 *  plane, so scoping them out only hid the tenant's own traffic. Canonicalized
 *  (lowercase, no port) to match the ingested host — see edge-logs/host. */
export async function listOrgDomains(organizationId: OrganizationId): Promise<string[]> {
  const rows = await db
    .select({ domain: proxyRoute.domain })
    .from(proxyRoute)
    .innerJoin(project, eq(project.id, proxyRoute.projectId))
    .where(eq(project.organizationId, organizationId));
  return [...new Set(rows.map((r) => normalizeHost(r.domain)))];
}

/** A project's enabled HTTP routes with their owning resource, for the
 *  route-stats join (host → resource). HTTP-only on purpose: layer4 routes
 *  (public DBs) never produce access-log rows, so listing them in a traffic
 *  view would just be permanent zeros. Org join = cross-tenant guard;
 *  deduped by canonical host (the unique key the stats are computed under). */
export async function listProjectRoutes(
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<Array<{ host: string; resourceId: ResourceId | null; isPrimary: boolean }>> {
  const rows = await db
    .select({
      domain: proxyRoute.domain,
      resourceId: proxyRoute.resourceId,
      isPrimary: proxyRoute.isPrimary,
    })
    .from(proxyRoute)
    .innerJoin(project, eq(project.id, proxyRoute.projectId))
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(proxyRoute.projectId, projectId),
        eq(proxyRoute.type, "http"),
        eq(proxyRoute.enabled, true),
      ),
    );
  const byHost = new Map<
    string,
    { host: string; resourceId: ResourceId | null; isPrimary: boolean }
  >();
  for (const r of rows) {
    const host = normalizeHost(r.domain);
    const existing = byHost.get(host);
    // A primary route wins the dedupe so the resource mapping stays canonical.
    if (!existing || (r.isPrimary && !existing.isPrimary)) {
      byHost.set(host, { host, resourceId: r.resourceId, isPrimary: r.isPrimary });
    }
  }
  return [...byHost.values()];
}

/** Map of domain → "upstreamHost:upstreamPort" for the org's HTTP routes, so
 *  the edge-log view can show which service each request was proxied to
 *  (Caddy's access log doesn't carry the upstream; we resolve it from the
 *  route). Scoped to one project when projectId is given. */
export async function listRouteUpstreams(
  organizationId: OrganizationId,
  projectId?: ProjectId,
): Promise<Record<string, string>> {
  const rows = await db
    .select({
      domain: proxyRoute.domain,
      host: proxyRoute.upstreamHost,
      port: proxyRoute.upstreamPort,
    })
    .from(proxyRoute)
    .innerJoin(project, eq(project.id, proxyRoute.projectId))
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(proxyRoute.type, "http"),
        projectId ? eq(proxyRoute.projectId, projectId) : undefined,
      ),
    );
  const map: Record<string, string> = {};
  // Key by the canonical host so `upstreams[row.host]` resolves against the
  // normalized host stored on each log row.
  for (const r of rows) map[normalizeHost(r.domain)] = `${r.host}:${r.port}`;
  return map;
}

/** A project's domains, but only if the project belongs to the org — the org
 *  filter is the cross-tenant guard. Not `type="http"`-restricted, and
 *  canonicalized, for the same reasons as listOrgDomains. */
export async function listProjectDomains(
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<string[]> {
  const rows = await db
    .select({ domain: proxyRoute.domain })
    .from(proxyRoute)
    .innerJoin(project, eq(project.id, proxyRoute.projectId))
    .where(and(eq(project.organizationId, organizationId), eq(proxyRoute.projectId, projectId)));
  return [...new Set(rows.map((r) => normalizeHost(r.domain)))];
}
