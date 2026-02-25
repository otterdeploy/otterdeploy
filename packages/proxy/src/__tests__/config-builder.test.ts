import { describe, it, expect } from "vitest";
import { buildRoute, buildRouteId } from "../config-builder";
import type { RouteTarget } from "../types";

const target: RouteTarget = {
  resourceId: "res-abc",
  domain: "app.example.com",
  upstream: "otterstack-res-abc",
  port: 3000,
};

describe("buildRouteId", () => {
  it("is deterministic for same inputs", () => {
    const id1 = buildRouteId("res-abc", "app.example.com");
    const id2 = buildRouteId("res-abc", "app.example.com");
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^route-res-abc-[a-f0-9]{6}$/);
  });
});

describe("buildRoute", () => {
  it("creates correct route structure", () => {
    const route = buildRoute(target);

    expect(route["@id"]).toBe(buildRouteId("res-abc", "app.example.com"));
    expect(route.match).toEqual([{ host: ["app.example.com"] }]);
    expect(route.terminal).toBe(true);
    expect(route.handle).toHaveLength(1);
    expect(route.handle[0].handler).toBe("reverse_proxy");
    expect(route.handle[0].upstreams).toEqual([
      { dial: "otterstack-res-abc:3000" },
    ]);
  });

  it("includes compression handler when option is set", () => {
    const route = buildRoute(target, { compression: true });

    expect(route.handle).toHaveLength(2);
    expect(route.handle[0].handler).toBe("encode");
    expect(route.handle[0].encodings).toEqual({ gzip: {}, zstd: {} });
    expect(route.handle[1].handler).toBe("reverse_proxy");
  });

  it("includes security headers handler when option is set", () => {
    const route = buildRoute(target, { securityHeaders: true });

    expect(route.handle).toHaveLength(2);
    expect(route.handle[0].handler).toBe("headers");
    expect(route.handle[0].response).toBeDefined();
    expect(route.handle[1].handler).toBe("reverse_proxy");
  });
});
