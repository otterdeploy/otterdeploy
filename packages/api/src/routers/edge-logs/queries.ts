import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

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
