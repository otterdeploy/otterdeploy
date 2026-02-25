import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "better-result";

// Mock caddy-client
const mockAddRoute = vi.fn();
const mockUpdateRoute = vi.fn();
const mockRemoveRouteById = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock("../caddy-client", () => ({
  addRoute: (...args: unknown[]) => mockAddRoute(...args),
  updateRoute: (...args: unknown[]) => mockUpdateRoute(...args),
  removeRouteById: (...args: unknown[]) => mockRemoveRouteById(...args),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

import {
  syncResourceProxy,
  syncDomainProxy,
  removeResourceProxy,
  syncServerProxy,
} from "../sync";
import { buildRouteId } from "../config-builder";
import type { SyncDeps } from "../sync";

beforeEach(() => {
  vi.clearAllMocks();
});

function createMockDeps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    getResourceDomains: vi.fn().mockResolvedValue([
      { domain: "app.example.com", verified: true },
      { domain: "staging.example.com", verified: false },
    ]),
    getResourcePort: vi.fn().mockResolvedValue(3000),
    getAllResources: vi.fn().mockResolvedValue([
      {
        id: "res-1",
        port: 3000,
        domains: [{ domain: "app.example.com" }],
      },
      {
        id: "res-2",
        port: 8080,
        domains: [{ domain: "api.example.com" }],
      },
    ]),
    ...overrides,
  };
}

describe("syncResourceProxy", () => {
  it("upserts routes for verified domains only", async () => {
    mockUpdateRoute.mockResolvedValue(Result.ok(undefined));

    const deps = createMockDeps();
    const result = await syncResourceProxy("res-1", deps);

    expect(result.isOk()).toBe(true);
    // Only verified domain should be synced (app.example.com), not staging.example.com
    expect(mockUpdateRoute).toHaveBeenCalledTimes(1);
    const [routeId, route] = mockUpdateRoute.mock.calls[0];
    expect(routeId).toBe(buildRouteId("res-1", "app.example.com"));
    expect(route["@id"]).toBe(buildRouteId("res-1", "app.example.com"));
  });

  it("skips unverified domains", async () => {
    mockUpdateRoute.mockResolvedValue(Result.ok(undefined));

    const deps = createMockDeps({
      getResourceDomains: vi.fn().mockResolvedValue([
        { domain: "unverified.example.com", verified: false },
      ]),
    });

    const result = await syncResourceProxy("res-1", deps);

    expect(result.isOk()).toBe(true);
    expect(mockUpdateRoute).not.toHaveBeenCalled();
    expect(mockAddRoute).not.toHaveBeenCalled();
  });
});

describe("removeResourceProxy", () => {
  it("removes routes for all specified domains", async () => {
    mockRemoveRouteById.mockResolvedValue(Result.ok(undefined));

    const domains = ["app.example.com", "api.example.com"];
    const result = await removeResourceProxy("res-1", domains);

    expect(result.isOk()).toBe(true);
    expect(mockRemoveRouteById).toHaveBeenCalledTimes(2);
    expect(mockRemoveRouteById).toHaveBeenCalledWith(
      buildRouteId("res-1", "app.example.com"),
    );
    expect(mockRemoveRouteById).toHaveBeenCalledWith(
      buildRouteId("res-1", "api.example.com"),
    );
  });
});

describe("syncServerProxy", () => {
  it("builds full config and loads it atomically", async () => {
    mockLoadConfig.mockResolvedValue(Result.ok(undefined));

    const deps = createMockDeps();
    const result = await syncServerProxy(deps);

    expect(result.isOk()).toBe(true);
    expect(mockLoadConfig).toHaveBeenCalledTimes(1);

    const config = mockLoadConfig.mock.calls[0][0];
    expect(config.admin).toEqual({ listen: "127.0.0.1:2019" });
    expect(config.apps.http.servers.srv0.listen).toEqual([":443"]);
    expect(config.apps.http.servers.srv0.routes).toHaveLength(2);
  });
});
