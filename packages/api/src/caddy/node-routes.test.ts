import { describe, expect, test } from "vite-plus/test";

import {
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
    // edge that looks healthy — worse than not answering at all.
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
