import { describe, expect, test } from "vite-plus/test";

import {
  checkDomainPlacement,
  domainsPointingElsewhere,
  domainOwners,
  domainsNeedingDnsMove,
  routesForNode,
  type RoutePlacement,
} from "./node-routes";

const route = (domain: string, placementServerId: string | null): RoutePlacement => ({
  domain,
  placementServerId,
});

const ALL = [
  route("a.example.com", "server_a"),
  route("b.example.com", "server_b"),
  route("free.example.com", null),
];

describe("routesForNode", () => {
  test("a worker serves only what is pinned to it", () => {
    const { routes } = routesForNode(ALL, "server_b", false);
    expect(routes.map((r) => r.domain)).toEqual(["b.example.com"]);
  });

  test("a worker never inherits unplaced routes", () => {
    // Serving a route whose backend is on another machine yields a 502 from an
    // edge that looks healthy, worse than not answering at all.
    const { routes } = routesForNode(ALL, "server_b", false);
    expect(routes.some((r) => r.domain === "free.example.com")).toBe(false);
  });

  test("the control plane serves its own plus everything unplaced", () => {
    const { routes } = routesForNode(ALL, "server_a", true);
    expect(routes.map((r) => r.domain).sort()).toEqual(["a.example.com", "free.example.com"]);
  });

  test("every route lands on exactly one edge", () => {
    // The invariant: no route orphaned, none served twice.
    const cp = routesForNode(ALL, "server_a", true).routes.map((r) => r.domain);
    const worker = routesForNode(ALL, "server_b", false).routes.map((r) => r.domain);
    const served = [...cp, ...worker].sort();
    expect(served).toEqual(["a.example.com", "b.example.com", "free.example.com"]);
    expect(new Set(served).size).toBe(served.length);
  });

  test("a node with nothing pinned to it serves nothing", () => {
    expect(routesForNode(ALL, "server_c", false).routes).toEqual([]);
  });
});

describe("domainOwners", () => {
  test("maps each domain to its serving server, null for unpinned", () => {
    const owners = domainOwners(ALL);
    expect(owners.get("a.example.com")).toBe("server_a");
    expect(owners.get("free.example.com")).toBeNull();
  });
});

describe("domainsNeedingDnsMove", () => {
  test("flags a domain whose serving node changed", () => {
    // A pinned service that moved is not actually moved until DNS follows.
    const before = domainOwners([route("a.example.com", "server_a")]);
    const after = domainOwners([route("a.example.com", "server_b")]);
    expect(domainsNeedingDnsMove(before, after)).toEqual(["a.example.com"]);
  });

  test("says nothing when placement is unchanged", () => {
    const owners = domainOwners(ALL);
    expect(domainsNeedingDnsMove(owners, owners)).toEqual([]);
  });

  test("a brand new domain is not a move", () => {
    const before = domainOwners([]);
    const after = domainOwners([route("new.example.com", "server_a")]);
    expect(domainsNeedingDnsMove(before, after)).toEqual([]);
  });

  test("pinning a previously unpinned domain counts as a move", () => {
    const before = domainOwners([route("a.example.com", null)]);
    const after = domainOwners([route("a.example.com", "server_b")]);
    expect(domainsNeedingDnsMove(before, after)).toEqual(["a.example.com"]);
  });
});

describe("checkDomainPlacement", () => {
  const at = (expected: string | null, resolved: string[]) =>
    checkDomainPlacement({
      domain: "a.example.com",
      expectedAddress: expected,
      resolvedAddresses: resolved,
    });

  test("is ok when the domain resolves to the serving node", () => {
    expect(at("5.6.7.8", ["5.6.7.8"])).toBe("ok");
  });

  test("is ok when the node is one of several answers", () => {
    // Multi-A is a legitimate setup, and the route is reachable as long as the
    // serving node is in the set.
    expect(at("5.6.7.8", ["1.2.3.4", "5.6.7.8"])).toBe("ok");
  });

  test("flags a domain still pointing at the old node", () => {
    // The whole bug: the pin moved the route, the A record stayed put.
    expect(at("5.6.7.8", ["1.2.3.4"])).toBe("points-elsewhere");
  });

  test("does not cry wolf on a name that resolves to nothing yet", () => {
    // A record added a minute ago. Undetermined is not a misconfiguration, and
    // reporting it as one would make the whole signal ignorable.
    expect(at("5.6.7.8", [])).toBe("undetermined");
  });

  test("stays quiet for an unpinned route", () => {
    // No expected address means the control-plane edge serves it. Unpinned is
    // the common case and has never needed a DNS move.
    expect(at(null, ["1.2.3.4"])).toBe("undetermined");
  });
});

describe("domainsPointingElsewhere", () => {
  const routes = [
    route("moved.example.com", "server_b"),
    route("fine.example.com", "server_a"),
    route("unpinned.example.com", null),
  ];
  const addressOf = (id: string | null) =>
    id === "server_a" ? "1.1.1.1" : id === "server_b" ? "2.2.2.2" : null;

  test("names only the domains whose DNS contradicts their node", () => {
    const resolved = new Map([
      ["moved.example.com", ["1.1.1.1"]],
      ["fine.example.com", ["1.1.1.1"]],
      ["unpinned.example.com", ["9.9.9.9"]],
    ]);
    expect(domainsPointingElsewhere(routes, addressOf, resolved)).toEqual(["moved.example.com"]);
  });

  test("reports nothing when no name resolves", () => {
    // A resolver outage must read as "we could not tell" across the board, not
    // as every domain being misconfigured at once.
    expect(domainsPointingElsewhere(routes, addressOf, new Map())).toEqual([]);
  });
});
