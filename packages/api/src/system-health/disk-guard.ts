/**
 * Disk-headroom guard for large, disk-consuming operations (self-update today;
 * deploys/builds/backups next). The pattern mirrors branch-pool's
 * `checkBranchHeadroom`: read free bytes on the data-root filesystem, and refuse
 * to start an operation that could fill the disk mid-flight. The self-update is
 * the motivating case — a full-disk `compose pull`/`up` can corrupt redis's AOF
 * and leave a half-recreated stack with no control plane (see the disk-safe
 * update work). So the guard: check → optionally reclaim unused images/cache →
 * re-check → let the caller ABORT before touching anything destructive.
 */
import { DATA_ROOT } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";

import { reclaimSpace } from "./reclaim";

const GB = 1024 ** 3;

/**
 * Free bytes on the data-root filesystem (where docker images + volumes live),
 * or null if it can't be read — callers treat null as "don't block on a guess".
 */
export async function freeDiskBytes(): Promise<number | null> {
  const path = existsSync(DATA_ROOT) ? DATA_ROOT : "/";
  const stat = await Result.tryPromise({ try: () => statfs(path), catch: () => null });
  if (stat.isErr()) return null;
  return stat.value.bavail * stat.value.bsize;
}

/**
 * Pure decision: is there headroom? A null free reading (couldn't statfs) never
 * blocks — we refuse to abort a real operation on an unreadable guess. Exported
 * so the threshold logic is unit-testable without a filesystem.
 */
export function hasHeadroom(freeBytes: number | null, neededBytes: number): boolean {
  if (freeBytes == null) return true;
  return freeBytes >= neededBytes;
}

export interface HeadroomResult {
  ok: boolean;
  freeBytes: number | null;
  neededBytes: number;
  reclaimedBytes: number;
  /** Human-readable reason when `ok` is false; null otherwise. */
  reason: string | null;
}

const gb = (bytes: number): string => `${(bytes / GB).toFixed(1)} GB`;

/**
 * Guard a disk-consuming operation: require `neededBytes` free. When short and
 * `reclaim` is set, prune unused images + build cache first (never volumes —
 * those can hold detached DB data) and re-check. Returns `ok:false` with the
 * numbers when still short, so the caller aborts BEFORE doing anything.
 */
export async function ensureDiskHeadroom(opts: {
  neededBytes: number;
  reclaim?: boolean;
}): Promise<HeadroomResult> {
  let free = await freeDiskBytes();
  let reclaimedBytes = 0;

  if (!hasHeadroom(free, opts.neededBytes) && opts.reclaim) {
    const res = await reclaimSpace(["images", "build-cache"]);
    reclaimedBytes = res.reclaimedBytes;
    free = await freeDiskBytes();
  }

  const ok = hasHeadroom(free, opts.neededBytes);
  return {
    ok,
    freeBytes: free,
    neededBytes: opts.neededBytes,
    reclaimedBytes,
    reason: ok
      ? null
      : `only ${gb(free ?? 0)} free, need ${gb(opts.neededBytes)}` +
        (reclaimedBytes > 0 ? ` (reclaimed ${gb(reclaimedBytes)})` : ""),
  };
}
