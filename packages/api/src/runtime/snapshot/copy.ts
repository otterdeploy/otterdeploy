/**
 * `copy` SnapshotDriver — the honest, always-available fallback (used when the
 * COW `zfs` path isn't provisioned on the host). It DOUBLES disk, so callers
 * log a warning when it's selected.
 *
 * Note the asymmetry vs the `zfs` driver: `zfs` clones the raw PGDATA volume
 * here, at the volume layer, before the branch container boots. `copy` CANNOT —
 * a logical `pg_dump | pg_restore` needs BOTH DB containers running, which only
 * exists a layer up. So the `copy` strategy's actual data movement happens in
 * `branchDatabase` on the runtime driver (§4.4/§4.5): it provisions a fresh
 * branch DB, then dumps the source and restores into it via the existing
 * backups transport. This driver's `branch()` is therefore a deliberate no-op
 * that just reports "no snapshot ref" — the branch is an ordinary fresh volume.
 *
 * See docs/designs/pr-previews.md §4.2.
 */
import type { BranchInput, BranchResult, SnapshotDriver } from "./types";

export const copyDriver: SnapshotDriver = {
  kind: "copy",

  // No-op: the branch's data is loaded by branchDatabase (dump+restore), not by
  // a volume clone. Nothing to snapshot, so there's no ref to return.
  async branch(_input: BranchInput): Promise<BranchResult> {
    return { snapshotRef: null };
  },

  // No-op: a `copy` branch owns an ordinary Docker volume with no snapshot. Its
  // volume is removed by destroyDatabaseBranch through the normal
  // container/volume teardown, so there is nothing snapshot-specific to clean up.
  async destroy(): Promise<void> {
    // intentionally empty — see the note above.
  },

  // Always available — a logical dump+restore works on any host.
  async probe(): Promise<boolean> {
    return true;
  },
};
