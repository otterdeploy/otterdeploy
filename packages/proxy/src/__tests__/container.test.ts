import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "better-result";

// Mock @otterdeploy/docker
const mockCreateService = vi.fn();
const mockInspectService = vi.fn();
const mockRemoveService = vi.fn();

vi.mock("@otterdeploy/docker", () => ({
  createService: (...args: unknown[]) => mockCreateService(...args),
  inspectService: (...args: unknown[]) => mockInspectService(...args),
  removeService: (...args: unknown[]) => mockRemoveService(...args),
}));

// Mock caddy-client healthCheck
const mockHealthCheck = vi.fn();

vi.mock("../caddy-client", () => ({
  healthCheck: (...args: unknown[]) => mockHealthCheck(...args),
}));

import { bootstrapCaddy, isCaddyRunning, restartCaddy } from "../container";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bootstrapCaddy", () => {
  it("creates service with correct spec", async () => {
    mockCreateService.mockResolvedValue(Result.ok("svc-caddy-123"));

    const result = await bootstrapCaddy();

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe("svc-caddy-123");

    const opts = mockCreateService.mock.calls[0][0];
    expect(opts.name).toBe("otterstack-caddy");
    expect(opts.image).toBe("caddy:2-alpine");
    expect(opts.volumes).toEqual([
      { source: "otterstack-caddy-data", target: "/data", type: "volume" },
      { source: "otterstack-caddy-config", target: "/config", type: "volume" },
    ]);
    expect(opts.ports).toEqual([
      { target: 80, published: 80 },
      { target: 443, published: 443 },
    ]);
    expect(opts.networks).toEqual(["otterstack-ingress"]);
    expect(opts.labels["otterstack.managed"]).toBe("true");
    expect(opts.labels["otterstack.network.role"]).toBe("ingress");
  });
});

describe("isCaddyRunning", () => {
  it("returns true when service exists and health check passes", async () => {
    mockInspectService.mockResolvedValue(
      Result.ok({
        id: "svc-caddy-123",
        name: "otterstack-caddy",
        image: "caddy:2-alpine",
        replicas: 1,
        labels: {},
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );
    mockHealthCheck.mockResolvedValue(true);

    const running = await isCaddyRunning();

    expect(running).toBe(true);
    expect(mockInspectService).toHaveBeenCalledWith("otterstack-caddy");
    expect(mockHealthCheck).toHaveBeenCalled();
  });

  it("returns false when service does not exist", async () => {
    mockInspectService.mockResolvedValue(
      Result.err(new Error("service not found")),
    );

    const running = await isCaddyRunning();

    expect(running).toBe(false);
  });
});

describe("restartCaddy", () => {
  it("removes and recreates service", async () => {
    mockRemoveService.mockResolvedValue(Result.ok(undefined));
    mockCreateService.mockResolvedValue(Result.ok("svc-caddy-new"));

    const result = await restartCaddy();

    expect(result.isOk()).toBe(true);
    expect(mockRemoveService).toHaveBeenCalledWith("otterstack-caddy");
    expect(mockCreateService).toHaveBeenCalled();
  });
});
