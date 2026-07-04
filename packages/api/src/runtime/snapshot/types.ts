import type { RequestLogger } from "evlog";

/**
 * SnapshotDriver abstraction — the copy-on-write DB-branching seam, consistent
 * with the `RuntimeDriver` pattern. A `SnapshotDriver` knows how to materialize
 * one database's volume as a branch of another's (and tear it down). The active
 * driver is selected at boot by `DB_BRANCH_STRATEGY` (see ./index.ts).
 *
 * Zod-first: every value set / spec is a `z.enum` / `z.object`, and the TS types
 * are inferred — one source of truth gives a runtime validator AND the static
 * type. The `branch_strategy` pg enum in @otterdeploy/db shares this value set.
 * See docs/designs/pr-previews.md §4.1.
 */
import { DATABASE_ENGINES, type DatabaseEngine } from "@otterdeploy/shared/database-engines";
import * as z from "zod";

// Engine value set, derived from the shared catalog so adding an engine there
// keeps this validator in sync (no hand-written duplicate).
export const databaseEngineSchema = z.enum(
  Object.keys(DATABASE_ENGINES) as [DatabaseEngine, ...DatabaseEngine[]],
);

// Strategy a branch was actually materialized with (matches branchStrategyEnum
// in @otterdeploy/db schema/project.ts §3.3).
export const branchStrategySchema = z.enum(["zfs", "copy"]);
export type BranchStrategy = z.infer<typeof branchStrategySchema>;

// Operator setting (`auto` = probe zfs, else copy). Used by env config (§9).
export const dbBranchStrategySettingSchema = z.enum(["auto", "zfs", "copy"]);
export type DbBranchStrategySetting = z.infer<typeof dbBranchStrategySettingSchema>;

export const branchInputSchema = z.object({
  sourceVolume: z.string(),
  targetVolume: z.string(),
  engine: databaseEngineSchema,
});
export type BranchInput = z.infer<typeof branchInputSchema>;

export const branchResultSchema = z.object({ snapshotRef: z.string().nullable() });
export type BranchResult = z.infer<typeof branchResultSchema>;

export interface SnapshotDriver {
  readonly kind: BranchStrategy;
  /** Materialize targetVolume as a branch of sourceVolume. Returns a ref for teardown. */
  branch(input: BranchInput, log?: RequestLogger): Promise<BranchResult>;
  /** Remove the branch volume (+ snapshot) on teardown. */
  destroy(
    input: { targetVolume: string; snapshotRef: string | null },
    log?: RequestLogger,
  ): Promise<void>;
  /** Boot-time probe: is this strategy usable on this host? */
  probe(): Promise<boolean>;
}
