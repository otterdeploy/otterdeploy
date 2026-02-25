import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "better-result";

import { waitForHealthy } from "../health-check";
import type { HealthCheckDeps } from "../health-check";

function createMockDeps(overrides: Partial<HealthCheckDeps> = {}): HealthCheckDeps {
  return {
    listContainers: vi.fn().mockResolvedValue(
      Result.ok([{ id: "container-1", state: "running", status: "Up 30 seconds" }]),
    ),
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("waitForHealthy", () => {
  it("returns ok when containers are running", async () => {
    const deps = createMockDeps();

    const result = await waitForHealthy(
      {
        deploymentId: "deploy-1",
        resourceId: "res-1",
      },
      deps,
    );

    expect(result.isOk()).toBe(true);
    expect(deps.listContainers).toHaveBeenCalledWith("otterstack-res-1");
    // Should not sleep since containers were immediately healthy
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it("returns error on timeout when no containers become healthy", async () => {
    const deps = createMockDeps({
      listContainers: vi.fn().mockResolvedValue(
        Result.ok([]), // Empty — no containers running
      ),
    });

    const result = await waitForHealthy(
      {
        deploymentId: "deploy-1",
        resourceId: "res-1",
        timeoutMs: 100, // Very short timeout for testing
        intervalMs: 20,
      },
      deps,
    );

    expect(result.isErr()).toBe(true);
    expect((result.error as Error).message).toContain("timed out");
    expect((result.error as Error).message).toContain("otterstack-res-1");
  });

  it("polls at the correct interval until healthy", async () => {
    let callCount = 0;
    const deps = createMockDeps({
      listContainers: vi.fn().mockImplementation(async () => {
        callCount++;
        // Return empty on first two calls, running on third
        if (callCount < 3) {
          return Result.ok([]);
        }
        return Result.ok([{ id: "c-1", state: "running", status: "Up 5 seconds" }]);
      }),
    });

    const result = await waitForHealthy(
      {
        deploymentId: "deploy-1",
        resourceId: "res-1",
        timeoutMs: 60_000,
        intervalMs: 50,
      },
      deps,
    );

    expect(result.isOk()).toBe(true);
    // Should have called listContainers 3 times
    expect(deps.listContainers).toHaveBeenCalledTimes(3);
    // Should have slept twice (between call 1->2 and 2->3)
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledWith(50);
  });
});
