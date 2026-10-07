/**
 * Which domains resolve somewhere other than the node that serves them.
 *
 * With a proxy per node a route lives on ONE machine's edge, so a pinned
 * service's domain has to resolve to that machine. Moving the pin moves the
 * route; nothing moves the A record. `routesForNode` then correctly refuses to
 * serve the route from any other node, so the visitor reaches an edge that does
 * not have it and the failure is total rather than degraded.
 *
 * `domainOwners` and `domainsNeedingDnsMove` computed the answer and had no
 * caller at all (od-rsc8). This is the missing half: resolve the names, and
 * turn the map into something an operator is actually shown.
 *
 * Best-effort by construction. A resolver that cannot answer yields
 * "undetermined", never "wrong": a name whose record was added a minute ago
 * resolves to nothing, and reporting that as a misconfiguration would cry wolf
 * on every fresh domain.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { server } from "@otterdeploy/db/schema/server";
import { and, eq } from "drizzle-orm";

import type { RoutePlacement } from "./node-routes";

import { resolveAddressesRobust } from "../lib/dns-resolver";
import { checkDomainPlacement, domainOwners } from "./node-routes";

export interface DomainPlacementReport {
  domain: string;
  /** The server the route is served from, null for the control-plane edge. */
  serverId: string | null;
  serverName: string | null;
  expectedAddress: string | null;
  resolvedAddresses: string[];
  verdict: "ok" | "points-elsewhere" | "undetermined";
}

/**
 * One organization's enabled routes, paired with the server their resource is
 * pinned to: the only routes an org-scoped report may describe.
 *
 * `listEnabledRoutePlacements` (./queries.ts) is install-wide on purpose: it
 * feeds every node's config. Handed to a tenant, it disclosed every other
 * organization's domains and made the report resolve each of them over public
 * DNS, so one tenant's read cost a lookup per route in the whole install. The
 * project join is the tenant boundary; the resource join stays LEFT for the
 * reason given there (a route may outlive or lack its resource row).
 */
export async function listOrganizationRoutePlacements(
  organizationId: OrganizationId,
): Promise<RoutePlacement[]> {
  const rows = await db
    .select({ domain: proxyRoute.domain, placementServerId: resource.placementServerId })
    .from(proxyRoute)
    .innerJoin(project, eq(proxyRoute.projectId, project.id))
    .leftJoin(resource, eq(proxyRoute.resourceId, resource.id))
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(proxyRoute.enabled, true),
        eq(proxyRoute.disabledByUser, false),
      ),
    );
  return rows.map((r) => ({ domain: r.domain, placementServerId: r.placementServerId ?? null }));
}

/**
 * Report on every routed domain for one organization.
 *
 * Resolution runs in parallel and failures are absorbed: one unreachable name
 * must not cost the report for the rest, and a resolver outage should read as
 * "we could not tell" across the board rather than as every domain being
 * misconfigured at once.
 */
export async function reportDomainPlacement(input: {
  organizationId: OrganizationId;
  routes: readonly RoutePlacement[];
}): Promise<DomainPlacementReport[]> {
  const owners = domainOwners(input.routes);
  if (owners.size === 0) return [];

  const servers = await db
    .select({ id: server.id, name: server.name, host: server.host })
    .from(server)
    .where(eq(server.organizationId, input.organizationId));
  // Keyed by plain string: `RoutePlacement` deliberately carries an unbranded
  // `placementServerId`, so the pure route-splitting module stays free of id
  // types. A branded id is assignable to string, so the widening is one-way and
  // safe.
  const byId = new Map<string, (typeof servers)[number]>(servers.map((s) => [s.id, s]));

  const domains = [...owners.keys()];
  const resolved = await Promise.all(
    domains.map(async (domain) => {
      const result = await resolveAddressesRobust(domain);
      return [domain, result.isOk() ? result.value : []] as const;
    }),
  );
  const addresses = new Map(resolved);

  return domains
    .map((domain) => {
      const serverId = owners.get(domain) ?? null;
      const owner = serverId ? byId.get(serverId) : undefined;
      const expectedAddress = owner?.host ?? null;
      const resolvedAddresses = [...(addresses.get(domain) ?? [])];
      return {
        domain,
        serverId,
        serverName: owner?.name ?? null,
        expectedAddress,
        resolvedAddresses,
        verdict: checkDomainPlacement({ domain, expectedAddress, resolvedAddresses }),
      };
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
