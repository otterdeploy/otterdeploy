import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, eq } from "drizzle-orm";

/** The HTTP domains owned by an org — the access-log visibility scope. */
export async function listOrgDomains(organizationId: OrganizationId): Promise<string[]> {
  const rows = await db
    .select({ domain: proxyRoute.domain })
    .from(proxyRoute)
    .innerJoin(project, eq(project.id, proxyRoute.projectId))
    .where(and(eq(project.organizationId, organizationId), eq(proxyRoute.type, "http")));
  return rows.map((r) => r.domain);
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
  for (const r of rows) map[r.domain] = `${r.host}:${r.port}`;
  return map;
}

/** A project's HTTP domains, but only if the project belongs to the org —
 *  the org filter is the cross-tenant guard. */
export async function listProjectDomains(
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<string[]> {
  const rows = await db
    .select({ domain: proxyRoute.domain })
    .from(proxyRoute)
    .innerJoin(project, eq(project.id, proxyRoute.projectId))
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(proxyRoute.projectId, projectId),
        eq(proxyRoute.type, "http"),
      ),
    );
  return rows.map((r) => r.domain);
}
