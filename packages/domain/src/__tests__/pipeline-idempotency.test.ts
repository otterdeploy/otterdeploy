import { describe, it, expect, vi } from "vitest";
import { Result } from "better-result";
import { cleanupBuild } from "../pipeline/cleanup";
import { cloneSource } from "../pipeline/clone";

describe("P0 Reliability: Pipeline Idempotency", () => {
  describe("clone step idempotency", () => {
    it("skips clone for docker_image build method", async () => {
      const deps = {
        cloneRepository: vi.fn(),
      };

      const result = await cloneSource(
        {
          deploymentId: "dep-1",
          builder: "docker_image",
          gitRepo: null,
          gitCommitSha: undefined,
        },
        deps,
      );

      expect(result.isOk()).toBe(true);
      expect(deps.cloneRepository).not.toHaveBeenCalled();
    });
  });

  describe("cleanup step idempotency", () => {
    it("does not fail when build dir does not exist", async () => {
      const deps = {
        removeDirectory: vi.fn().mockResolvedValue(undefined),
        pruneOldTags: vi.fn().mockResolvedValue(Result.ok([])),
      };

      // Should not throw even if directory doesn't exist
      const result = await cleanupBuild(
        {
          deploymentId: "dep-1",
          resourceId: "res-1",
          sourceDir: "/tmp/nonexistent",
        },
        deps,
      );

      // Cleanup should be non-fatal
      expect(deps.removeDirectory).toHaveBeenCalled();
    });

    it("handles prune failure gracefully", async () => {
      const deps = {
        removeDirectory: vi.fn().mockResolvedValue(undefined),
        pruneOldTags: vi.fn().mockResolvedValue(Result.err(new Error("Prune failed"))),
      };

      // Should not throw even on prune failure
      const result = await cleanupBuild(
        {
          deploymentId: "dep-1",
          resourceId: "res-1",
          sourceDir: "/tmp/otterstack-builds/dep-1",
        },
        deps,
      );

      // Non-fatal — should still complete
      expect(deps.removeDirectory).toHaveBeenCalled();
    });
  });
});
