/**
 * `zfs` SnapshotDriver: instant, copy-on-write database branching.
 *
 * A branch is `zfs snapshot` + `zfs clone`: the clone shares blocks with its
 * origin until written to, so it is constant-time and near-free regardless of
 * database size. This is the tier the installer provisions a pool for
 * (`install.sh` → `provision_branching`, dataset `<pool>/pg`).
 *
 * ── Safety properties this file is responsible for ──────────────────────────
 *
 * **Destroy order: clone BEFORE snapshot.** ZFS refuses to destroy a snapshot
 * while a clone depends on it, so the reverse order fails on the first call.
 * Both steps tolerate the object already being gone, because a teardown that
 * dies between them would otherwise leave a snapshot holding disk and blocking
 * the base database's delete permanently.
 *
 * **Never `zfs promote`.** Promotion would reparent a clone so the origin
 * becomes destroyable, and it is the wrong tool here. It makes an ephemeral PR
 * preview the origin holder of production's blocks, inverting the lifetime
 * relationship: the short-lived thing then pins the long-lived one. The
 * operation exists; it is not for this.
 *
 * **Every name is validated before it reaches a shell.** `runOnHost` executes
 * a script as root in the host's namespaces and its contract is that the script
 * is trusted, fixed text. Dataset names here derive from volume names, so they
 * are checked against a strict allowlist first and the call is refused
 * otherwise: an injection here is arbitrary root code on the host.
 */
import type { RequestLogger } from "evlog";

import { createError, log } from "evlog";

import type { BranchInput, BranchResult, SnapshotDriver } from "./types";

import { runOnHost } from "../../system-health/host-run";

/** The pool the installer recorded. Read raw off env for the same reason
 *  branch-pool.ts does. Keep full env validation out of the deploy import
 *  graph. */
function pool(): string | null {
  // oxlint-disable-next-line node/no-process-env -- intentional raw read (see note)
  const raw = process.env.BRANCH_ZFS_POOL?.trim();
  return raw ? raw : null;
}

/**
 * ZFS dataset and snapshot names are far more permissive than what we ever
 * generate, so this is deliberately narrower than ZFS itself allows: the names
 * come from `buildVolumeName`, which already produces
 * `[a-z0-9][a-z0-9_.-]*`. Anything outside that is a bug or an attack, and
 * either way must not reach a root shell.
 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function assertSafe(name: string, what: string): void {
  if (!SAFE_NAME.test(name)) {
    throw createError({
      message: `refusing to run a host command with an unsafe ${what}`,
      status: 400,
      why: `"${name}" is outside the allowed character set; this value reaches a root shell`,
    });
  }
}

/** `<pool>/pg/<volume>`: the dataset backing one database's PGDATA. */
function dataset(volume: string): string {
  const p = pool();
  if (!p) {
    throw createError({
      message: "zfs branching requested but no pool is configured",
      status: 500,
      why: "BRANCH_ZFS_POOL is unset. The installer did not provision a pool",
    });
  }
  assertSafe(p, "pool name");
  assertSafe(volume, "volume name");
  return `${p}/pg/${volume}`;
}

/** Snapshot name for a branch. Derived from the target so teardown can
 *  recompute it, and so a second branch of the same source is distinct. */
function snapshotRef(sourceVolume: string, targetVolume: string): string {
  return `${dataset(sourceVolume)}@${targetVolume}`;
}

/** Does this dataset exist? Used for per-database driver selection. A database
 *  provisioned before the ZFS tier existed is on a plain Docker volume and has
 *  nothing to clone. */
export async function datasetExists(volume: string): Promise<boolean> {
  if (!pool()) return false;
  let name: string;
  try {
    name = dataset(volume);
  } catch {
    return false;
  }
  const ran = await runOnHost(`zfs list -H -o name ${name} >/dev/null 2>&1`);
  return ran.isOk() && ran.value.exitCode === 0;
}

export const zfsDriver: SnapshotDriver = {
  kind: "zfs",

  async branch(input: BranchInput, rlog?: RequestLogger): Promise<BranchResult> {
    const source = dataset(input.sourceVolume);
    const target = dataset(input.targetVolume);
    const snap = snapshotRef(input.sourceVolume, input.targetVolume);

    // A stale snapshot from a failed earlier attempt would make `zfs snapshot`
    // fail with "dataset already exists"; destroying it first makes the branch
    // idempotent. `-r` is deliberately NOT used. This must never recurse into
    // datasets we did not create.
    const ran = await runOnHost(
      [
        "set -e",
        `zfs destroy ${snap} 2>/dev/null || true`,
        `zfs snapshot ${snap}`,
        `zfs clone -o mountpoint=none ${snap} ${target}`,
      ].join("\n"),
    );
    if (ran.isErr() || ran.value.exitCode !== 0) {
      // Leave nothing half-made: a clone that failed after the snapshot landed
      // would pin the origin forever with no row referencing it.
      await runOnHost(`zfs destroy ${snap} 2>/dev/null || true`);
      throw createError({
        message: `zfs branch failed for ${input.sourceVolume} → ${input.targetVolume}`,
        status: 500,
        why: ran.isErr() ? ran.error.message : ran.value.output.slice(0, 500),
      });
    }
    rlog?.info?.(`zfs: cloned ${source} → ${target}`);
    return { snapshotRef: snap };
  },

  async destroy(
    input: { targetVolume: string; snapshotRef: string | null },
    rlog?: RequestLogger,
  ): Promise<void> {
    const target = dataset(input.targetVolume);
    // Order is load-bearing: the clone holds its origin snapshot alive, so the
    // snapshot cannot go first. Both tolerate absence so a teardown that died
    // between the two steps completes on re-run rather than erroring on the
    // clone it already removed.
    const script = [`zfs destroy ${target} 2>/dev/null || true`];
    if (input.snapshotRef) {
      assertSafe(input.snapshotRef.replace(/[@/]/g, "-"), "snapshot ref");
      script.push(`zfs destroy ${input.snapshotRef} 2>/dev/null || true`);
    }
    const ran = await runOnHost(script.join("\n"));
    if (ran.isErr()) {
      // Best-effort by contract, but never silent: a snapshot left behind holds
      // disk AND blocks the base database's delete, so the orphan sweep needs
      // to know about it.
      log.warn({
        snapshot: { step: "zfs-destroy", target: input.targetVolume },
        err: ran.error,
      });
      return;
    }
    rlog?.info?.(`zfs: destroyed ${target}`);
  },

  /** Is the ZFS tier usable on this host at all? Per-database suitability is a
   *  separate question: see `datasetExists`. */
  async probe(): Promise<boolean> {
    const p = pool();
    if (!p) return false;
    const ran = await runOnHost(`zpool list -H -o name ${p} >/dev/null 2>&1`);
    return ran.isOk() && ran.value.exitCode === 0;
  },
};
