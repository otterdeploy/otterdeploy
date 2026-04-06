import { describe, expect, mock, test } from "bun:test";

import { reconcileRoutes } from "../reconciler";
import type { ProxyRouteInput } from "../builder";

describe("reconciler", () => {
  const httpRoute: ProxyRouteInput = {
    projectId: "project_abc",
    type: "http",
    domain: "myapp.otterstack.dev",
    upstreamHost: "myapp.otterstack.internal",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
  };

  const layer4Route: ProxyRouteInput = {
    projectId: "project_xyz",
    type: "layer4",
    domain: "db.otterstack.dev",
    upstreamHost: "db.otterstack.internal",
    upstreamPort: 5432,
    protocol: "tcp",
    layer4Alpn: "postgresql",
  };

  test("applies all routes when all projects validate", async () => {
    const adaptFn = mock(() => Promise.resolve({ ok: true as const, json: {} }));
    const loadFn = mock(() => Promise.resolve({ ok: true as const }));

    const result = await reconcileRoutes({
      routes: [httpRoute, layer4Route],
      adminBind: "0.0.0.0:2019",
      adapt: adaptFn,
      load: loadFn,
    });

    expect(result.applied).toEqual(["project_abc", "project_xyz"]);
    expect(result.skipped).toEqual([]);
    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  test("skips a project whose fragment fails validation", async () => {
    const adaptFn = mock((caddyfile: string) => {
      if (caddyfile.includes("myapp.otterstack.dev")) {
        return Promise.resolve({ ok: false as const, error: "bad config" });
      }
      return Promise.resolve({ ok: true as const, json: {} });
    });
    const loadFn = mock(() => Promise.resolve({ ok: true as const }));

    const result = await reconcileRoutes({
      routes: [httpRoute, layer4Route],
      adminBind: "0.0.0.0:2019",
      adapt: adaptFn,
      load: loadFn,
    });

    expect(result.applied).toEqual(["project_xyz"]);
    expect(result.skipped).toEqual([
      { projectId: "project_abc", error: "bad config" },
    ]);
    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  test("returns empty applied when load fails", async () => {
    const adaptFn = mock(() => Promise.resolve({ ok: true as const, json: {} }));
    const loadFn = mock(() =>
      Promise.resolve({ ok: false as const, error: "caddy down" }),
    );

    const result = await reconcileRoutes({
      routes: [httpRoute],
      adminBind: "0.0.0.0:2019",
      adapt: adaptFn,
      load: loadFn,
    });

    expect(result.applied).toEqual([]);
    expect(result.loadError).toBe("caddy down");
  });

  test("handles empty routes", async () => {
    const adaptFn = mock(() => Promise.resolve({ ok: true as const, json: {} }));
    const loadFn = mock(() => Promise.resolve({ ok: true as const }));

    const result = await reconcileRoutes({
      routes: [],
      adminBind: "0.0.0.0:2019",
      adapt: adaptFn,
      load: loadFn,
    });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(loadFn).toHaveBeenCalledTimes(1);
  });
});
