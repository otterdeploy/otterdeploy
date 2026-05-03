import { describe, expect, it } from "vitest";
import { useCanvasNodes } from "./use-canvas-nodes";
import type { DatabaseFromApi, ProxyRouteFromApi } from "../api/schema";

function makeDatabase(over: Partial<DatabaseFromApi> = {}): DatabaseFromApi {
  return {
    resourceId: "res_1",
    projectId: "proj_1",
    name: "primary",
    type: "database",
    status: "valid",
    engine: "postgres",
    databaseName: "app",
    username: "admin",
    password: "secret",
    publicHostname: "primary.proj1.local",
    publicPort: 5432,
    publicConnectionString: "postgres://...",
    internalHostname: "primary.internal",
    internalPort: 5432,
    internalConnectionString: "postgres://...",
    localConnectionString: null,
    upstreamHost: "primary",
    upstreamPort: 5432,
    runtime: {
      serviceId: "svc",
      serviceName: "primary",
      volumeName: "primary-data",
      networkName: "proj1",
      status: "running",
      health: "healthy",
    },
    ...over,
  } as DatabaseFromApi;
}

function makeRoute(over: Partial<ProxyRouteFromApi> = {}): ProxyRouteFromApi {
  return {
    id: "rt_1",
    projectId: "proj_1",
    resourceId: null,
    type: "http",
    domain: "app.example.com",
    upstreamHost: "primary",
    upstreamPort: 5432,
    protocol: "http",
    layer4Alpn: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("useCanvasNodes", () => {
  it("emits a routing node, a data group, and one database+volume per database", () => {
    const { nodes } = useCanvasNodes({
      databases: [makeDatabase()],
      proxyRoutes: [makeRoute()],
    });
    const kinds = nodes.map((n) => n.type);
    expect(kinds.filter((k) => k === "routing")).toHaveLength(1);
    expect(kinds.filter((k) => k === "group")).toHaveLength(1);
    expect(kinds.filter((k) => k === "database")).toHaveLength(1);
    expect(kinds.filter((k) => k === "volume")).toHaveLength(1);
  });

  it("parents database and volume nodes to the data group", () => {
    const { nodes } = useCanvasNodes({
      databases: [makeDatabase({ resourceId: "res_a" }), makeDatabase({ resourceId: "res_b", name: "secondary" })],
      proxyRoutes: [],
    });
    const group = nodes.find((n) => n.type === "group");
    expect(group).toBeDefined();
    const databases = nodes.filter((n) => n.type === "database");
    const volumes = nodes.filter((n) => n.type === "volume");
    expect(databases.every((n) => n.parentId === group!.id)).toBe(true);
    expect(volumes.every((n) => n.parentId === group!.id)).toBe(true);
  });

  it("when no databases, still emits a routing node and an empty group", () => {
    const { nodes } = useCanvasNodes({ databases: [], proxyRoutes: [] });
    expect(nodes.find((n) => n.type === "routing")).toBeDefined();
    expect(nodes.find((n) => n.type === "group")).toBeDefined();
    expect(nodes.find((n) => n.type === "database")).toBeUndefined();
  });

  it("the routing node summarizes enabled http+layer4 domains", () => {
    const { nodes } = useCanvasNodes({
      databases: [],
      proxyRoutes: [makeRoute({ domain: "a.example.com", type: "http" }), makeRoute({ id: "rt_2", domain: "b.example.com", type: "layer4" })],
    });
    const routing = nodes.find((n) => n.type === "routing");
    expect(routing).toBeDefined();
    const data = routing!.data as { domains: ReadonlyArray<{ domain: string; type: "http" | "layer4" }> };
    expect(data.domains).toHaveLength(2);
    expect(data.domains.map((d) => d.domain).sort()).toEqual(["a.example.com", "b.example.com"]);
  });
});
