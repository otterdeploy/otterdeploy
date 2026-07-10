import type { Edge } from "@xyflow/react";

import { describe, expect, it } from "vite-plus/test";

import type { HostTraffic, RouteSourceResource } from "./route-traffic";

import {
  buildRouteTopology,
  canonicalHost,
  decorateTrafficEdges,
  formatRps,
  summarizeTraffic,
  trafficStrokeWidth,
} from "./route-traffic";

const service = (over?: Partial<RouteSourceResource>): RouteSourceResource => ({
  type: "service",
  name: "web",
  stackId: null,
  publicEnabled: true,
  publicDomain: "web.example.com",
  ...over,
});

const traffic = (host: string, over?: Partial<HostTraffic>): HostTraffic => ({
  host,
  resourceId: null,
  isPrimary: true,
  rps: 2,
  errorRate: 0,
  p50: 10,
  p95: 40,
  ...over,
});

describe("canonicalHost", () => {
  it("lowercases and strips a port, keeping IPv6 literals intact", () => {
    expect(canonicalHost("Web.Example.com:8443")).toBe("web.example.com");
    expect(canonicalHost("[::1]:443")).toBe("[::1]");
    expect(canonicalHost("plain.example.com")).toBe("plain.example.com");
  });
});

describe("trafficStrokeWidth", () => {
  it("keeps the canvas default for quiet edges", () => {
    expect(trafficStrokeWidth(0)).toBe(1.25);
    expect(trafficStrokeWidth(-1)).toBe(1.25);
  });

  it("grows monotonically with rps and caps at 4", () => {
    const w1 = trafficStrokeWidth(1);
    const w10 = trafficStrokeWidth(10);
    const w1k = trafficStrokeWidth(1000);
    expect(w1).toBeGreaterThan(1.25);
    expect(w10).toBeGreaterThan(w1);
    expect(w1k).toBeGreaterThan(w10);
    expect(trafficStrokeWidth(1_000_000)).toBe(4);
  });
});

describe("formatRps", () => {
  it("scales precision with magnitude", () => {
    expect(formatRps(0.034)).toBe("0.03");
    expect(formatRps(42.13)).toBe("42.1");
    expect(formatRps(312.4)).toBe("312");
    expect(formatRps(1234)).toBe("1.2k");
  });
});

describe("buildRouteTopology", () => {
  it("emits a route pill + traffic edge per public standalone service", () => {
    const { nodes, edges } = buildRouteTopology([service()]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "route:web.example.com",
      type: "route",
      data: { kind: "route", name: "web.example.com" },
    });
    expect(edges).toEqual([
      {
        id: "route:web.example.com->service:web",
        source: "route:web.example.com",
        target: "service:web",
        type: "traffic",
        data: { host: "web.example.com" },
      },
    ]);
  });

  it("skips private services, compose members, and databases", () => {
    const { nodes } = buildRouteTopology([
      service({ publicEnabled: false }),
      service({ name: "worker", publicDomain: null }),
      service({ name: "member", stackId: "resource_stack" }),
      { type: "database", name: "db" },
    ]);
    expect(nodes).toHaveLength(0);
  });

  it("canonicalizes the host so it matches the stats key", () => {
    const { edges } = buildRouteTopology([service({ publicDomain: "Web.Example.com:8443" })]);
    expect(edges[0]?.data?.host).toBe("web.example.com");
  });
});

describe("decorateTrafficEdges", () => {
  const routeEdge: Edge = {
    id: "route:web.example.com->service:web",
    source: "route:web.example.com",
    target: "service:web",
    type: "traffic",
    data: { host: "web.example.com" },
  };
  const depEdge: Edge = { id: "a->b", source: "a", target: "b" };

  it("animates + widens edges with live traffic and attaches the label payload", () => {
    const out = decorateTrafficEdges(
      [routeEdge, depEdge],
      new Map([["web.example.com", traffic("web.example.com", { rps: 9, p95: 120 })]]),
      false,
    );
    expect(out[0]).toMatchObject({
      animated: true,
      data: { rps: 9, p95: 120 },
    });
    expect(out[0]?.style?.strokeWidth).toBeGreaterThan(1.25);
    // Dependency edges pass through untouched.
    expect(out[1]).toBe(depEdge);
  });

  it("leaves zero-traffic route edges plain", () => {
    const out = decorateTrafficEdges(
      [routeEdge],
      new Map([["web.example.com", traffic("web.example.com", { rps: 0 })]]),
      false,
    );
    expect(out[0]?.animated).toBeUndefined();
    expect(out[0]?.style?.strokeWidth).toBeUndefined();
  });

  it("swaps animation for a static dash pattern under reduced motion", () => {
    const out = decorateTrafficEdges(
      [routeEdge],
      new Map([["web.example.com", traffic("web.example.com", { rps: 9 })]]),
      true,
    );
    expect(out[0]?.animated).toBe(false);
    expect(out[0]?.style?.strokeDasharray).toBe("6 4");
  });
});

describe("summarizeTraffic", () => {
  it("returns null when no host saw traffic (chip is omitted)", () => {
    expect(summarizeTraffic(undefined)).toBeNull();
    expect(summarizeTraffic([])).toBeNull();
    expect(summarizeTraffic([traffic("a.example.com", { rps: 0 })])).toBeNull();
  });

  it("sums rps and takes the worst p95 across live hosts only", () => {
    const out = summarizeTraffic([
      traffic("a.example.com", { rps: 2, p95: 40 }),
      traffic("b.example.com", { rps: 3, p95: 220 }),
      traffic("quiet.example.com", { rps: 0, p95: 0 }),
    ]);
    expect(out).toEqual({ totalRps: 5, worstP95: 220 });
  });
});
