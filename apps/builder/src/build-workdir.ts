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
import { join, resolve, sep } from "node:path";

import { DATA_ROOT } from "@otterdeploy/shared/paths";

const BUILDS_DIR = join(DATA_ROOT, "builds");
/** Persistent BuildKit layer cache (see buildx.ts), one subdir per image repo. */
const CACHE_DIR = join(DATA_ROOT, "buildx-cache");

/** How long a failed build's clone lingers for inspection before the sweep
 *  reclaims it. */
const BUILD_TTL_MS = 24 * 60 * 60 * 1000; // 24h
/** How long an unused layer-cache dir lingers before it's reclaimed. The cache
 *  is touched on every build that uses it (`--cache-to`), so its mtime tracks
 *  last use — a repo not built in this window sheds its cache. Generous because
 *  the cache is pure speedup: dropping a live one only costs one slow rebuild. */
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14d

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

/**
 * Reclaim BuildKit layer-cache dirs (`buildx-cache/<repo>`) unused for longer
 * than {@link CACHE_TTL_MS}. Without this the cache grows unbounded (BuildKit's
 * local cache has no GC) and eventually fills the disk. Best-effort + guarded:
 * each removal stays inside `CACHE_DIR`, and a vanished/locked entry is skipped,
 * never thrown. No-op when the cache dir doesn't exist (dev / no data folder).
 */
export async function pruneStaleBuildCache(
  now = Date.now(),
  cacheDir = CACHE_DIR,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return; // cache dir absent → nothing to prune
  }
  const cacheRoot = resolve(cacheDir);
  await Promise.all(
    entries.map(async (name) => {
      const dir = join(cacheDir, name);
      // Guard: never rm outside the cache root (e.g. a stray symlink/`..`).
      if (!resolve(dir).startsWith(cacheRoot + sep)) return;
      try {
        const info = await stat(dir);
        if (now - info.mtimeMs > CACHE_TTL_MS) {
          await rm(dir, { recursive: true, force: true });
        }
      } catch {
        // entry vanished or is mid-use — leave it for the next sweep
      }
    }),
  );
}
