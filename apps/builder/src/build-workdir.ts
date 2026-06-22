/**
 * Build work-dir retention. A failed build's clone is KEPT (under the host data
 * folder) so an operator can inspect what went wrong; successful builds are
 * cleaned immediately. This sweep caps the disk those kept clones can hold by
 * reclaiming any build dir older than the TTL — run opportunistically at the
 * start of each build. See docs/designs/data-folder.md.
 *
 * No-op when the data folder isn't in use (dev / tmpdir fallback): the builds
 * dir won't exist, so there's nothing to sweep — and ephemeral tmpdir work dirs
 * are cleaned on failure anyway (only `persistent` dirs are kept).
 */
import { readdir, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { DATA_ROOT } from "@otterdeploy/shared/paths";

const BUILDS_DIR = join(DATA_ROOT, "builds");

/** How long a failed build's clone lingers for inspection before the sweep
 *  reclaims it. */
const BUILD_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Remove build dirs whose mtime is older than {@link BUILD_TTL_MS}. Build clones
 * now live two levels deep — `builds/<projectId>/<deploymentId>` — so this walks
 * each project's bucket, prunes stale deployment dirs, then drops the project
 * bucket once it's empty (`rmdir` fails on a non-empty dir, which we ignore).
 * Best-effort + racy-safe: a vanished/locked entry is skipped, never thrown.
 */
export async function pruneStaleBuilds(now = Date.now()): Promise<void> {
  let projectBuckets: string[];
  try {
    projectBuckets = await readdir(BUILDS_DIR);
  } catch {
    return; // builds dir absent → nothing to prune
  }
  await Promise.all(
    projectBuckets.map(async (projectId) => {
      const bucket = join(BUILDS_DIR, projectId);
      let builds: string[];
      try {
        builds = await readdir(bucket);
      } catch {
        return; // not a dir / vanished
      }
      await Promise.all(
        builds.map(async (name) => {
          const dir = join(bucket, name);
          try {
            const info = await stat(dir);
            if (now - info.mtimeMs > BUILD_TTL_MS) {
              await rm(dir, { recursive: true, force: true });
            }
          } catch {
            // entry vanished or is mid-use — leave it for the next sweep
          }
        }),
      );
      // Reclaim the project bucket if pruning emptied it.
      await rmdir(bucket).catch(() => undefined);
    }),
  );
}
