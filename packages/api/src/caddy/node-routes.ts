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

/**
 * Does this domain's DNS point at the node that actually serves it?
 *
 * The question a pinned service raises and nothing was asking. With a proxy per
 * node, a route lives on ONE machine's edge; the domain has to resolve there.
 * Pin a service to another box and the route moves while the A record does not,
 * so the visitor keeps reaching an edge that no longer has the route - and
 * `routesForNode` correctly refuses to serve it from the wrong node, which is
 * right and also why the failure is total rather than degraded.
 *
 * PURE. The resolving is the caller's job (see `checkDomainPlacement`), because
 * the interesting part is the comparison and it should be testable without DNS.
 *
 * A domain with no addresses is UNDETERMINED, not wrong: nothing resolves yet
 * on a name whose record was added a minute ago, and reporting that as a
 * misconfiguration would cry wolf on every fresh domain. Only an answer that
 * contradicts the owner is a mismatch.
 */
export interface DomainPlacement {
  domain: string;
  /** Address the serving node answers on, or null for the control-plane edge. */
  expectedAddress: string | null;
  resolvedAddresses: readonly string[];
}

export type DomainPlacementVerdict = "ok" | "points-elsewhere" | "undetermined";

export function checkDomainPlacement(input: DomainPlacement): DomainPlacementVerdict {
  if (input.resolvedAddresses.length === 0) return "undetermined";
  // No expected address means the control-plane edge serves it, and the control
  // plane's own address is not something this layer knows. Unpinned routes are
  // the common case and have never needed a DNS move, so silence is correct.
  if (input.expectedAddress === null) return "undetermined";
  return input.resolvedAddresses.includes(input.expectedAddress) ? "ok" : "points-elsewhere";
}

/**
 * Every domain whose DNS contradicts its serving node, given resolved
 * addresses.
 *
 * Built on `domainOwners`, which computed exactly this input and had no caller
 * until now (od-rsc8): the map was right, nothing consumed it.
 */
export function domainsPointingElsewhere(
  all: readonly RoutePlacement[],
  addressOfServer: (serverId: string | null) => string | null,
  resolved: ReadonlyMap<string, readonly string[]>,
): string[] {
  const owners = domainOwners(all);
  const wrong: string[] = [];
  for (const [domain, serverId] of owners) {
    const verdict = checkDomainPlacement({
      domain,
      expectedAddress: addressOfServer(serverId),
      resolvedAddresses: resolved.get(domain) ?? [],
    });
    if (verdict === "points-elsewhere") wrong.push(domain);
  }
  return wrong.sort();
}
