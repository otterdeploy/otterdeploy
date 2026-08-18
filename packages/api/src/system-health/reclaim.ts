/**
 * Space reclamation: the one-click fixes behind the health recommendations.
 * Three deliberately safe targets:
 *
 *   images      → `image prune` with dangling=false (all images unused by any
 *                 container: old deploy images live here; re-pulled if needed)
 *   build-cache → BuildKit cache prune (idle daemon entries) PLUS the data
 *                 folder's `cache/` tree (the `cache/buildx` layer caches).
 *                 `cache/` is regenerable by contract: always safe to wipe
 *                 entirely; the next build just starts cold and re-warms it
 *   containers  → stopped containers, LIMITED to otterdeploy-managed ones so a
 *                 shared host's other stopped containers are never touched
 *   branch-pool → `zpool trim` on the branching pool, punching freed branch-DB
 *                 blocks back out of its sparse image file (host disk returns)
 *
 * Volumes are intentionally NOT reclaimable from here: an unreferenced volume
 * can be a detached database's data. That stays a manual, informed decision.
 */
import { Docker } from "@otterdeploy/docker";
import { DATA_ROOT } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
import { log } from "evlog";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { ReclaimTarget } from "./host-health";

import { removeGuardedDir } from "../lib/data-dir";
import { trimBranchPool } from "./branch-pool";

/** Best-effort recursive size of a path (0 when absent/unreadable). */
async function pathSizeBytes(path: string): Promise<number> {
  try {
    const info = await lstat(path);
    if (info.isFile()) return info.size;
    if (!info.isDirectory()) return 0;
    let total = 0;
    for (const name of await readdir(path)) {
      total += await pathSizeBytes(join(path, name));
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Wipe the data folder's `cache/` tree (BuildKit layer caches under
 * `cache/buildx`: the on-disk export caches the daemon prune can't see).
 * Removes each child through the guarded remover (never the `cache/` dir
 * itself); best-effort, returns the bytes measured before removal.
 */
async function wipeDataCache(): Promise<number> {
  const cacheRoot = join(DATA_ROOT, "cache");
  let names: string[];
  try {
    names = await readdir(cacheRoot);
  } catch {
    return 0; // cache dir absent (dev / no data folder) → nothing to wipe
  }
  let freed = 0;
  for (const name of names) {
    const child = join(cacheRoot, name);
    freed += await pathSizeBytes(child);
    await removeGuardedDir(child, name);
  }
  return freed;
}

export interface ReclaimResult {
  target: ReclaimTarget;
  ok: boolean;
  reclaimedBytes: number;
  error: string | null;
}

async function pruneOne(docker: Docker, target: ReclaimTarget): Promise<ReclaimResult> {
  const run = async (): Promise<number> => {
    switch (target) {
      case "images": {
        const res = await docker.images.prune({ filters: { dangling: ["false"] } });
        if (res.isErr()) throw res.error;
        return res.value.SpaceReclaimed;
      }
      case "build-cache": {
        const res = await docker.system.pruneBuilder({ all: true });
        if (res.isErr()) throw res.error;
        return res.value.SpaceReclaimed + (await wipeDataCache());
      }
      case "containers": {
        const res = await docker.containers.prune({
          filters: { label: ["otterdeploy.managed=true"] },
        });
        if (res.isErr()) throw res.error;
        return res.value.SpaceReclaimed;
      }
      case "branch-pool": {
        const res = await trimBranchPool();
        if (!res.ok) throw new Error(res.error ?? "branch-pool trim failed");
        return res.reclaimedBytes;
      }
    }
  };

  const pruned = await Result.tryPromise({ try: run, catch: (cause) => cause });
  if (pruned.isErr()) {
    const message = pruned.error instanceof Error ? pruned.error.message : String(pruned.error);
    log.warn({ health: { step: "reclaim", target }, error: message });
    return { target, ok: false, reclaimedBytes: 0, error: message };
  }
  return { target, ok: true, reclaimedBytes: pruned.value, error: null };
}

/** Run the requested prunes in sequence (they contend on the daemon anyway).
 *  Per-target failures are reported, never thrown: a locked build cache must
 *  not stop the image prune from freeing space. */
export async function reclaimSpace(targets: ReclaimTarget[]): Promise<{
  results: ReclaimResult[];
  reclaimedBytes: number;
}> {
  const docker = Docker.fromEnv();
  try {
    const results: ReclaimResult[] = [];
    for (const target of new Set(targets)) {
      results.push(await pruneOne(docker, target));
    }
    const reclaimedBytes = results.reduce((sum, r) => sum + r.reclaimedBytes, 0);
    log.info({ health: { step: "reclaim-done", reclaimedBytes, targets } });
    return { results, reclaimedBytes };
  } finally {
    docker.destroy();
  }
}
