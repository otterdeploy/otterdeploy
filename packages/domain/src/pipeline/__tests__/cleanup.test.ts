import { describe, it, expect, vi } from "vitest";
import { Result } from "better-result";

import { cleanupBuild } from "../cleanup";
import type { CleanupDeps } from "../cleanup";

function createMockDeps(overrides: Partial<CleanupDeps> = {}): CleanupDeps {
  return {
    removeDirectory: vi.fn().mockResolvedValue(undefined),
    pruneOldTags: vi.fn().mockResolvedValue(Result.ok(["otterstack-res-1:v1", "otterstack-res-1:v2"])),
    ...overrides,
  };
}

describe("cleanupBuild", () => {
  it("removes the build directory", async () => {
    const deps = createMockDeps();

    const result = await cleanupBuild(
      {
        deploymentId: "deploy-1",
        resourceId: "res-1",
        sourceDir: "/tmp/otterstack-builds/deploy-1/src",
      },
      deps,
    );

    expect(result.isOk()).toBe(true);
    // Should remove the parent build directory, not the source subdir
    expect(deps.removeDirectory).toHaveBeenCalledWith("/tmp/otterstack-builds/deploy-1");
  });

  it("prunes old image tags with default keep count", async () => {
    const deps = createMockDeps();

    const result = await cleanupBuild(
      {
        deploymentId: "deploy-1",
        resourceId: "res-1",
        sourceDir: "/tmp/otterstack-builds/deploy-1",
      },
      deps,
    );

    expect(result.isOk()).toBe(true);
    expect(deps.pruneOldTags).toHaveBeenCalledWith("res-1", 10);
  });

  it("does not fail the pipeline when cleanup errors occur", async () => {
    const deps = createMockDeps({
      removeDirectory: vi.fn().mockRejectedValue(new Error("Permission denied")),
      pruneOldTags: vi.fn().mockResolvedValue(Result.err(new Error("Docker unavailable"))),
    });

    const result = await cleanupBuild(
      {
        deploymentId: "deploy-1",
        resourceId: "res-1",
        sourceDir: "/tmp/otterstack-builds/deploy-1",
      },
      deps,
    );

    // Should still return ok — cleanup errors are non-fatal
    expect(result.isOk()).toBe(true);
  });
});
