import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

const log = createLogger("pipeline:cleanup");

export interface CleanupDeps {
  /**
   * Remove a directory recursively.
   */
  removeDirectory: (path: string) => Promise<void>;

  /**
   * Prune old image tags for a resource, keeping the most recent N.
   */
  pruneOldTags: (resourceId: string, keep?: number) => Promise<Result<string[], Error>>;
}

/**
 * Step 10: Cleanup.
 * - Removes the build directory (/tmp/otterstack-builds/{deploymentId}/)
 * - Prunes old image tags (keeps last 10 by default)
 *
 * Idempotent: removing a non-existent directory is a no-op.
 * Pruning is idempotent by nature.
 *
 * This step should not fail the pipeline — errors are logged but not propagated.
 */
export async function cleanupBuild(
  input: {
    deploymentId: string;
    resourceId: string;
    sourceDir: string;
    keepImageTags?: number;
  },
  deps: CleanupDeps,
): Promise<Result<void, Error>> {
  const { deploymentId, resourceId, sourceDir } = input;
  const keep = input.keepImageTags ?? 10;

  // Remove build directory
  if (sourceDir) {
    try {
      // Clean up the parent build directory, not just the source subdir
      const buildDir = `/tmp/otterstack-builds/${deploymentId}`;
      await deps.removeDirectory(buildDir);
      log.info({ deploymentId, buildDir }, "Build directory removed");
    } catch (error) {
      log.warn(
        { err: error, deploymentId, sourceDir },
        "Failed to remove build directory (non-fatal)",
      );
    }
  }

  // Prune old image tags
  try {
    const pruneResult = await deps.pruneOldTags(resourceId, keep);
    if (pruneResult.isOk()) {
      const removed = pruneResult.value;
      if (removed.length > 0) {
        log.info(
          { deploymentId, resourceId, removedCount: removed.length },
          "Old image tags pruned",
        );
      }
    } else {
      log.warn(
        { err: pruneResult.error, deploymentId, resourceId },
        "Failed to prune old tags (non-fatal)",
      );
    }
  } catch (error) {
    log.warn(
      { err: error, deploymentId, resourceId },
      "Failed to prune old tags (non-fatal)",
    );
  }

  return Result.ok(undefined);
}
