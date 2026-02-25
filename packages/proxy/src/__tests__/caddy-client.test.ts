import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getConfig, addRoute, removeRouteById, updateRoute, healthCheck } from "../caddy-client";
import type { CaddyRoute } from "../types";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getConfig", () => {
  it("returns config on success", async () => {
    const mockConfig = {
      apps: {
        http: {
          servers: {
            srv0: { listen: [":443"], routes: [] },
          },
        },
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockConfig),
    });

    const result = await getConfig();

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual(mockConfig);
    expect(mockFetch).toHaveBeenCalledWith("http://127.0.0.1:2019/config/");
  });
});

describe("addRoute", () => {
  it("posts correct body to correct path", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const route: CaddyRoute = {
      "@id": "route-res1-abc123",
      match: [{ host: ["example.com"] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "otterstack-res1:3000" }] }],
      terminal: true,
    };

    const result = await addRoute(route, "srv0");

    expect(result.isOk()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:2019/config/apps/http/servers/srv0/routes",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(route),
      },
    );
  });
});

describe("removeRouteById", () => {
  it("deletes correct path", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await removeRouteById("route-res1-abc123");

    expect(result.isOk()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:2019/id/route-res1-abc123",
      { method: "DELETE" },
    );
  });
});

describe("updateRoute", () => {
  it("patches correct path with correct body", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const route: CaddyRoute = {
      "@id": "route-res1-abc123",
      match: [{ host: ["example.com"] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "otterstack-res1:3000" }] }],
      terminal: true,
    };

    const result = await updateRoute("route-res1-abc123", route);

    expect(result.isOk()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:2019/id/route-res1-abc123",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(route),
      },
    );
  });
});

describe("healthCheck", () => {
  it("returns true when config endpoint responds 200", async () => {
    mockFetch.mockResolvedValue({ status: 200 });

    const result = await healthCheck();

    expect(result).toBe(true);
  });

  it("returns false when fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("connection refused"));

    const result = await healthCheck();

    expect(result).toBe(false);
  });
});
