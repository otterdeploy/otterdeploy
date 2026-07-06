/**
 * ZFS branching-pool introspection + lifecycle (docs/designs/db-branching.md,
 * "Pool sizing, reclamation, growth"). The installer provisions a file-backed
 * pool as a SPARSE image under the data dir — its apparent size is a growth
 * ceiling, but every block ZFS ever writes stays materialized on the host
 * filesystem until trimmed. This module keeps that honest:
 *
 *   getBranchPoolHealth  → what the pool really costs the host right now
 *                          (physical image bytes vs data actually in the pool)
 *   trimBranchPool       → punch freed blocks back out of the sparse image
 *                          (one-click reclaim; also flips autotrim on)
 *   growBranchPool       → raise the ceiling when the pool fills, guarded so
 *                          the promise never exceeds what the disk can deliver
 *   checkBranchHeadroom  → pre-branch guard: refuse new branch DBs when the
 *                          host disk is too low to absorb one
 *
 * `zpool` runs on the host via ./host-run. The image file itself is visible
 * directly: compose bind-mounts the data dir at the same path on both sides.
 * BRANCH_ZFS_POOL is read raw off process.env (not `@otterdeploy/env`) so the
 * runtime driver can import the guard without dragging full env validation
 * into the deploy import graph — same idiom as runtime/snapshot/index.ts.
 */
import { DATA_ROOT } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
import { log } from "evlog";
import { existsSync } from "node:fs";
import { stat, statfs } from "node:fs/promises";

import { runOnHost } from "./host-run";

const GB = 1024 * 1024 * 1024;
const IMAGE_PATH = `${DATA_ROOT}/branch-pool.img`;
/** Keep this much host disk free no matter what the pool wants. */
const HOST_DISK_RESERVE_BYTES = 2 * GB;
const GROW_STEP_BYTES = 10 * GB;

/** Pool name, or null when the install runs without the ZFS tier. Restricted
 *  charset so the name can be safely interpolated into helper scripts. */
function poolName(): string | null {
  // oxlint-disable-next-line node/no-process-env -- intentional raw read (see module note)
  const raw = process.env.BRANCH_ZFS_POOL?.trim();
  if (!raw) return null;
  return /^[\w.:-]+$/.test(raw) ? raw : null;
}

// ── introspection ────────────────────────────────────────────────────────────

export interface BranchPoolHealth {
  pool: string;
  /** ONLINE / DEGRADED / SUSPENDED…; null when zpool couldn't be read. */
  health: string | null;
  sizeBytes: number | null;
  allocBytes: number | null;
  freeBytes: number | null;
  autotrim: boolean | null;
  /** File-backed vdev stats; null when the pool sits on a real disk. */
  imagePath: string | null;
  /** Apparent (sparse) size — the pool's growth ceiling. */
  imageMaxBytes: number | null;
  /** Blocks actually materialized — what the image really costs the host. */
  imagePhysicalBytes: number | null;
  /** Physical bytes a trim would hand back to the host (best estimate). */
  reclaimableBytes: number;
  /** Non-null when the pool is filling AND the host disk can absorb a grow. */
  suggestGrowBytes: number | null;
}

interface ZpoolStats {
  sizeBytes: number;
  allocBytes: number;
  freeBytes: number;
  health: string;
  autotrim: boolean;
}

// zpool reads spawn a privileged helper container — cache briefly so the UI's
// 60s hostHealth poll doesn't pay that on every tick.
let zpoolCache: { at: number; pool: string; value: ZpoolStats | null } | null = null;
const ZPOOL_CACHE_MS = 45_000;

function invalidateZpoolCache(): void {
  zpoolCache = null;
}

function parseZpool(exitCode: number, output: string): ZpoolStats | null {
  if (exitCode !== 0) return null;
  const [listLine, autotrimLine] = output.trim().split("\n");
  const [size, alloc, free, health] = listLine?.trim().split(/\s+/) ?? [];
  if (!size || !alloc || !free || !health) return null;
  return {
    sizeBytes: Number(size),
    allocBytes: Number(alloc),
    freeBytes: Number(free),
    health,
    autotrim: autotrimLine?.trim() === "on",
  };
}

async function readZpool(pool: string): Promise<ZpoolStats | null> {
  const now = Date.now();
  if (zpoolCache && zpoolCache.pool === pool && now - zpoolCache.at < ZPOOL_CACHE_MS) {
    return zpoolCache.value;
  }
  const ran = await runOnHost(
    `zpool list -Hp -o size,alloc,free,health ${pool} && zpool get -H -o value autotrim ${pool}`,
  );
  const parsed = ran.match({
    ok: ({ exitCode, output }) => parseZpool(exitCode, output),
    err: () => null,
  });
  zpoolCache = { at: now, pool, value: parsed };
  return parsed;
}

interface ImageStats {
  maxBytes: number;
  physicalBytes: number;
}

async function readImageStats(): Promise<ImageStats | null> {
  const st = await Result.tryPromise({ try: () => stat(IMAGE_PATH), catch: () => null });
  if (st.isErr()) return null;
  return { maxBytes: st.value.size, physicalBytes: st.value.blocks * 512 };
}

async function hostFreeBytes(): Promise<number | null> {
  const path = existsSync(DATA_ROOT) ? DATA_ROOT : "/";
  const fs = await Result.tryPromise({ try: () => statfs(path), catch: () => null });
  return fs.isOk() ? fs.value.bavail * fs.value.bsize : null;
}

/** Suggest growing only when the pool is genuinely filling AND the host can
 *  absorb the new ceiling without breaking the reserve. Never suggest an
 *  overcommit — a pool that outpromises the disk suspends on ENOSPC. */
function suggestGrow(
  image: ImageStats | null,
  zpool: ZpoolStats | null,
  hostFree: number | null,
): number | null {
  if (!image || !zpool || hostFree == null) return null;
  if (zpool.allocBytes / zpool.sizeBytes < 0.7) return null;
  const step = Math.min(GROW_STEP_BYTES, hostFree - HOST_DISK_RESERVE_BYTES);
  return step >= 1 * GB ? step : null;
}

const NO_ZPOOL = {
  health: null,
  sizeBytes: null,
  allocBytes: null,
  freeBytes: null,
  autotrim: null,
};

export async function getBranchPoolHealth(): Promise<BranchPoolHealth | null> {
  const pool = poolName();
  if (!pool) return null;

  const [image, zpool, hostFree] = await Promise.all([
    readImageStats(),
    readZpool(pool),
    hostFreeBytes(),
  ]);
  // Neither the image file nor zpool is visible → the env var is stale
  // (pool was destroyed); report nothing instead of an all-null husk.
  if (!image && !zpool) return null;

  return {
    pool,
    ...(zpool
      ? {
          health: zpool.health,
          sizeBytes: zpool.sizeBytes,
          allocBytes: zpool.allocBytes,
          freeBytes: zpool.freeBytes,
          autotrim: zpool.autotrim,
        }
      : NO_ZPOOL),
    imagePath: image ? IMAGE_PATH : null,
    imageMaxBytes: image ? image.maxBytes : null,
    imagePhysicalBytes: image ? image.physicalBytes : null,
    // Freed-but-still-materialized blocks. Only claimable when both sides are
    // known; alloc includes pool metadata, so this slightly understates — fine.
    reclaimableBytes: image && zpool ? Math.max(0, image.physicalBytes - zpool.allocBytes) : 0,
    suggestGrowBytes: suggestGrow(image, zpool, hostFree),
  };
}

// ── trim ─────────────────────────────────────────────────────────────────────

export interface TrimResult {
  ok: boolean;
  reclaimedBytes: number;
  error: string | null;
}

/** Trim the pool so freed blocks are punched back out of the sparse image.
 *  Also flips autotrim on, so future branch deletions self-clean. */
export async function trimBranchPool(): Promise<TrimResult> {
  const pool = poolName();
  if (!pool) return { ok: false, reclaimedBytes: 0, error: "no branching pool configured" };

  const before = await readImageStats();
  // `-w` (wait) needs OpenZFS 2.0+; older hosts fall back to polling status.
  // The poll is bounded (~10 min) so a stuck trim can't pin the helper forever.
  const ran = await runOnHost(
    [
      `zpool trim -w ${pool} 2>/dev/null || {`,
      `  zpool trim ${pool} || exit 1`,
      `  i=0`,
      `  while zpool status -t ${pool} 2>/dev/null | grep -q trimming && [ "$i" -lt 300 ]; do sleep 2; i=$((i+1)); done`,
      `}`,
      `zpool set autotrim=on ${pool} 2>/dev/null || true`,
    ].join("\n"),
  );
  invalidateZpoolCache();

  if (ran.isErr() || ran.value.exitCode !== 0) {
    const error = ran.isErr() ? ran.error.message : ran.value.output.trim() || "zpool trim failed";
    log.warn({ health: { step: "branch-pool-trim", pool }, error });
    return { ok: false, reclaimedBytes: 0, error };
  }

  const after = await readImageStats();
  const reclaimedBytes =
    before && after ? Math.max(0, before.physicalBytes - after.physicalBytes) : 0;
  log.info({ health: { step: "branch-pool-trim", pool, reclaimedBytes } });
  return { ok: true, reclaimedBytes, error: null };
}

// ── grow ─────────────────────────────────────────────────────────────────────

export type GrowResult =
  | { ok: true; addedBytes: number; imageMaxBytes: number }
  | { ok: false; reason: string };

/** Raise the file-backed pool's ceiling by `stepBytes` (default 10G). Refuses
 *  when the host disk couldn't back the new promise — see module note. */
export async function growBranchPool(stepBytes = GROW_STEP_BYTES): Promise<GrowResult> {
  const pool = poolName();
  if (!pool) return { ok: false, reason: "no branching pool configured" };

  const step = Math.round(stepBytes);
  if (step < 1 * GB || step > 100 * GB) {
    return { ok: false, reason: "grow step must be between 1G and 100G" };
  }
  const image = await readImageStats();
  if (!image) {
    return { ok: false, reason: "pool is not file-backed — grow the underlying disk instead" };
  }
  const hostFree = await hostFreeBytes();
  if (hostFree == null || hostFree - step < HOST_DISK_RESERVE_BYTES) {
    return { ok: false, reason: "not enough free disk to back the larger pool" };
  }

  const ran = await runOnHost(
    `truncate -s +${step} ${IMAGE_PATH} && zpool online -e ${pool} ${IMAGE_PATH}`,
  );
  invalidateZpoolCache();
  if (ran.isErr() || ran.value.exitCode !== 0) {
    const reason = ran.isErr() ? ran.error.message : ran.value.output.trim() || "grow failed";
    log.warn({ health: { step: "branch-pool-grow", pool }, error: reason });
    return { ok: false, reason };
  }

  const after = await readImageStats();
  log.info({ health: { step: "branch-pool-grow", pool, addedBytes: step } });
  return { ok: true, addedBytes: step, imageMaxBytes: after?.maxBytes ?? image.maxBytes + step };
}

// ── pre-branch guard ─────────────────────────────────────────────────────────

export type HeadroomCheck = { ok: true } | { ok: false; reason: string };

/** Cheap pre-flight before materializing a branch database: a `copy` branch
 *  duplicates the source's data and a `zfs` branch materializes sparse-image
 *  blocks as it diverges — both come out of the host disk. Refusing up front
 *  beats a half-restored branch (copy) or a suspended pool (zfs). */
export async function checkBranchHeadroom(): Promise<HeadroomCheck> {
  const free = await hostFreeBytes();
  if (free == null) return { ok: true }; // can't read → don't block on a guess
  if (free < HOST_DISK_RESERVE_BYTES) {
    return {
      ok: false,
      reason: `host disk has only ${(free / GB).toFixed(1)} GB free — below the ${HOST_DISK_RESERVE_BYTES / GB} GB reserve; free space (or grow the disk) before branching`,
    };
  }
  return { ok: true };
}
