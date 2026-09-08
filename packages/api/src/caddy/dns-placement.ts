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
import { server } from "@otterdeploy/db/schema/server";
import { eq } from "drizzle-orm";

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
