/**
 * Which routes belong on which node's edge.
 *
 * With a proxy per node (see routers/server/provision-node-proxy), each edge
 * must serve exactly the services running on its own machine, and nothing
 * else. Two failure modes to avoid, in opposite directions:
 *
 *   - A route on the WRONG node answers with a certificate it can obtain but a
 *     backend it cannot reach. That is worse than not answering: the visitor
 *     gets a 502 from a healthy-looking edge instead of failing over.
 *   - A route on NO node is simply unreachable, with nothing in the logs to say
 *     why. Unplaced routes therefore fall back to the control-plane edge, which
 *     is where everything lives today, rather than vanishing.
 *
 * Pure and exactly assertable: the whole point is that the split is decided
 * here rather than inferred inside a template.
 */

/** The subset of a proxy route this decision needs. */
export interface RoutePlacement {
  domain: string;
  /** The resource's pinned server, or null when the scheduler chose. */
  placementServerId: string | null;
  /** Whether this route's resource is a managed database (layer4) or http. */
  type?: "http" | "layer4";
}

export interface NodeRouteSplit {
  /** Routes this node's edge should serve. */
  routes: RoutePlacement[];
  /** Routes with no placement, served by the control-plane edge. */
  unplaced: RoutePlacement[];
}

/**
 * Split routes for one node.
 *
 * `isControlPlane` decides who inherits the unplaced ones: exactly one edge
 * must, or an unpinned service becomes unreachable the moment per-node edges
 * exist.
 */
export function routesForNode(
  all: readonly RoutePlacement[],
  nodeServerId: string,
  isControlPlane: boolean,
): NodeRouteSplit {
  const mine = all.filter((r) => r.placementServerId === nodeServerId);
  const unplaced = all.filter((r) => r.placementServerId == null);
  return {
    routes: isControlPlane ? [...mine, ...unplaced] : mine,
    unplaced,
  };
}

/**
 * Every domain, mapped to the server that should answer for it. The input a
 * DNS reconciler needs, and what an operator has to be told when a service is
 * pinned somewhere its domain doesn't point.
 *
 * Null means "the control-plane edge", which is also the answer for anything
 * unpinned.
 */
export function domainOwners(all: readonly RoutePlacement[]): Map<string, string | null> {
  const owners = new Map<string, string | null>();
  for (const route of all) {
    owners.set(route.domain, route.placementServerId ?? null);
  }
  return owners;
}

/**
 * Domains whose serving node changed between two reconciles. The set whose DNS
 * has to move. Moving a pinned service is not complete until this is empty or
 * acted on.
 */
export function domainsNeedingDnsMove(
  before: ReadonlyMap<string, string | null>,
  after: ReadonlyMap<string, string | null>,
): string[] {
  const moved: string[] = [];
  for (const [domain, owner] of after) {
    if (before.has(domain) && before.get(domain) !== owner) moved.push(domain);
  }
  return moved.sort();
}
