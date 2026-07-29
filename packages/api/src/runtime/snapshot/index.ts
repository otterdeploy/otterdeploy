/**
 * Snapshot-driver selector. Mirrors runtime/index.ts: a single
 * `DB_BRANCH_STRATEGY` switch (default `auto`) picks the COW backend used for
 * per-preview database branching. `auto` probes for the fastest usable
 * strategy; an explicit value forces it.
 *
 Two drivers exist: `copy` (real, always-available, doubles disk) and `zfs`
 * (instant, copy-on-write, needs a provisioned pool AND the database's PGDATA
 * on a dataset).
 *
 * Selection is PER DATABASE, not per host, because those two conditions differ
 * per database: a database created before the ZFS tier existed sits on a plain
 * Docker volume with nothing to clone, even on a host with a healthy pool.
 * Resolving once per host would silently break branching that works today.
 * See docs/designs/pr-previews.md §4.1.
 */
import { log } from "evlog";

import type { SnapshotDriver } from "./types";

import { copyDriver } from "./copy";
import { dbBranchStrategySettingSchema } from "./types";
import { datasetExists, zfsDriver } from "./zfs";

// Read straight off process.env (not the validated `@otterdeploy/env` object)
// so importing the branching layer — which the deploy path does — never drags
// full env validation into the import graph. Same idiom as runtime/index.ts.
function setting(): "auto" | "zfs" | "copy" {
  // oxlint-disable-next-line node/no-process-env -- intentional raw read (see note above): importing @otterdeploy/env here would pull full env validation into the deploy import graph.
  const raw = process.env.DB_BRANCH_STRATEGY;
  const parsed = dbBranchStrategySettingSchema.safeParse(raw);
  return parsed.success ? parsed.data : "auto";
}

/**
 * Resolve the active snapshot driver for this process. Async because a real
 * probe (P3 zfs) touches the host; `copy` is a constant-true probe today.
 */
export async function resolveSnapshotDriver(): Promise<SnapshotDriver> {
  const mode = setting();
  if (mode === "copy") return copyDriver;
  return (await zfsDriver.probe()) ? zfsDriver : copyDriver;
}

/**
 * The driver to branch ONE database with.
 *
 * `copy` when the host has no pool, when the operator forced it, or — the case
 * that matters — when this particular database's PGDATA is not on a dataset.
 * The last check is what lets a ZFS-capable host keep branching pre-existing
 * databases instead of failing them.
 */
export async function resolveSnapshotDriverFor(sourceVolume: string): Promise<SnapshotDriver> {
  const mode = setting();
  if (mode === "copy") return copyDriver;

  if (!(await zfsDriver.probe())) {
    if (mode === "zfs") {
      log.warn({
        snapshot: {
          step: "resolve",
          requested: "zfs",
          selected: "copy",
          reason: "no usable ZFS pool on this host",
        },
      });
    }
    return copyDriver;
  }

  if (await datasetExists(sourceVolume)) return zfsDriver;

  // Pool is fine, this database just predates it. Info, not warn: it is the
  // expected state for every database created before the ZFS tier, and warning
  // on each one would be noise rather than signal.
  log.info({
    snapshot: {
      step: "resolve",
      selected: "copy",
      volume: sourceVolume,
      reason: "database is not on a ZFS dataset",
    },
  });
  return copyDriver;
}

export type {
  BranchInput,
  BranchResult,
  BranchStrategy,
  DbBranchStrategySetting,
  SnapshotDriver,
} from "./types";
