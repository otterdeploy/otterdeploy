/**
 * Snapshot-driver selector. Mirrors runtime/index.ts: a single
 * `DB_BRANCH_STRATEGY` switch (default `auto`) picks the COW backend used for
 * per-preview database branching. `auto` probes for the fastest usable
 * strategy; an explicit value forces it.
 *
 * P2 only ships the `copy` driver (real, always-available, doubles disk). The
 * `zfs` COW driver lands in P3 — until then `auto` resolves to `copy`, and an
 * explicit `zfs` request also falls back to `copy` with a logged warning.
 * See docs/designs/pr-previews.md §4.1.
 */
import { log } from "evlog";

import type { SnapshotDriver } from "./types";

import { copyDriver } from "./copy";
import { dbBranchStrategySettingSchema } from "./types";

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
  // TODO(P3): zfs driver — probe the ZFS pool and return zfsDriver when usable.
  if (mode === "zfs") {
    log.warn({
      snapshot: {
        step: "resolve",
        requested: "zfs",
        selected: "copy",
        reason: "zfs driver not implemented until P3; falling back to copy",
      },
    });
  }
  return copyDriver;
}

export type {
  BranchInput,
  BranchResult,
  BranchStrategy,
  DbBranchStrategySetting,
  SnapshotDriver,
} from "./types";
export {
  branchInputSchema,
  branchResultSchema,
  branchStrategySchema,
  databaseEngineSchema,
  dbBranchStrategySettingSchema,
} from "./types";
