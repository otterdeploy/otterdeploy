import { describe, it, expect, vi } from "vitest";
import { Result } from "better-result";
import { runBootstrap, validateSetupConfig } from "../server-bootstrap";
import type { BootstrapDeps } from "../server-bootstrap";

function createMockDeps(overrides: Partial<BootstrapDeps> = {}): BootstrapDeps {
  return {
    isSwarmActive: vi.fn().mockResolvedValue(false),
    initSwarm: vi.fn().mockResolvedValue(Result.ok({ nodeId: "node-1", alreadyActive: false })),
    createIngressNetwork: vi.fn().mockResolvedValue(Result.ok({ networkId: "net-1", alreadyExists: false })),
    isCaddyRunning: vi.fn().mockResolvedValue(false),
    bootstrapCaddy: vi.fn().mockResolvedValue(Result.ok("caddy-service-id")),
    healthCheckCaddy: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("server-bootstrap", () => {
  describe("runBootstrap", () => {
    it("runs full bootstrap sequence successfully", async () => {
      const deps = createMockDeps();
      const result = await runBootstrap(deps);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.swarm.active).toBe(true);
        expect(result.value.network.networkId).toBe("net-1");
        expect(result.value.caddy.bootstrapped).toBe(true);
        expect(result.value.caddy.healthy).toBe(true);
      }
    });

    it("skips swarm init when already active", async () => {
      const deps = createMockDeps({
        isSwarmActive: vi.fn().mockResolvedValue(true),
      });
      const result = await runBootstrap(deps);

      expect(result.isOk()).toBe(true);
      expect(deps.initSwarm).not.toHaveBeenCalled();
    });

    it("skips caddy bootstrap when already running", async () => {
      const deps = createMockDeps({
        isCaddyRunning: vi.fn().mockResolvedValue(true),
      });
      const result = await runBootstrap(deps);

      expect(result.isOk()).toBe(true);
      expect(deps.bootstrapCaddy).not.toHaveBeenCalled();
    });

    it("returns partial result when swarm init fails", async () => {
      const deps = createMockDeps({
        initSwarm: vi.fn().mockResolvedValue(Result.err(new Error("Swarm init failed"))),
        isSwarmActive: vi.fn().mockResolvedValue(false),
      });
      const result = await runBootstrap(deps);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.swarm.active).toBe(false);
      }
    });
  });

  describe("validateSetupConfig", () => {
    it("validates valid config", () => {
      const result = validateSetupConfig({
        adminEmail: "admin@example.com",
        organizationName: "My Org",
        serverDomain: "apps.example.com",
        acmeEmail: "acme@example.com",
      });
      expect(result.isOk()).toBe(true);
    });

    it("rejects invalid email", () => {
      const result = validateSetupConfig({
        adminEmail: "not-an-email",
        organizationName: "My Org",
        serverDomain: "apps.example.com",
        acmeEmail: "acme@example.com",
      });
      expect(result.isErr()).toBe(true);
    });

    it("rejects short org name", () => {
      const result = validateSetupConfig({
        adminEmail: "admin@example.com",
        organizationName: "X",
        serverDomain: "apps.example.com",
        acmeEmail: "acme@example.com",
      });
      expect(result.isErr()).toBe(true);
    });

    it("rejects short domain", () => {
      const result = validateSetupConfig({
        adminEmail: "admin@example.com",
        organizationName: "My Org",
        serverDomain: "ab",
        acmeEmail: "acme@example.com",
      });
      expect(result.isErr()).toBe(true);
    });
  });
});
