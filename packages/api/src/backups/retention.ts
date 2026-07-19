/**
 * Residual storage-ceiling retention — the pure decision layer for the ONE
 * retention control rustic can't express natively.
 *
 * GFS pruning (keep the newest per day/week/month/year) and the hard max-age cut
 * now belong to `rustic forget` (`--keep-daily/-weekly/-monthly/-yearly` +
 * `--keep-within <N>d`); the scheduler drives that per repo. The only knob with
 * no native rustic flag is a byte ceiling — `maxStorageGb` — so it stays here as
 * a residual: given the snapshots rustic kept (newest-first), pick the oldest
 * survivors to drop until the total fits.
 *
 * Pure + side-effect free so it can be unit-tested and so the scheduler stays
 * focused on I/O. Input is newest-first; output is the subset to delete.
 *
 * ⚠️ Not yet wired into the scheduler: `rustic forget` takes a keep policy, not
 * explicit snapshot ids, so there is no snapshot-level delete to enforce this
 * selection against without desyncing rows from the repo. Retained for when a
 * snapshot-level forget lands.
 */

export interface RetentionPolicy {
  /** Storage ceiling in GB — prune oldest survivors until total fits. */
  maxStorageGb: number | null;
}

export interface RetainableBackup {
  id: string;
  completedAt: Date | null;
  compressedSizeBytes: number | null;
}

/**
 * Decide which of the surviving backups to prune to stay under the storage
 * ceiling. `backups` MUST be newest-first. With no ceiling set, keeps
 * everything.
 */
export function selectBackupsToPrune<T extends RetainableBackup>(
  backups: T[],
  policy: RetentionPolicy,
): T[] {
  if (policy.maxStorageGb == null) return [];

  const cap = policy.maxStorageGb * 1e9;
  const kept = new Set(backups.map((b) => b.id));

  // Oldest-first: shed the oldest survivors until the running total fits.
  const oldestFirst = [...backups].sort(
    (a, c) => (a.completedAt?.getTime() ?? 0) - (c.completedAt?.getTime() ?? 0),
  );
  let total = oldestFirst.reduce((s, b) => s + (b.compressedSizeBytes ?? 0), 0);
  for (const b of oldestFirst) {
    if (total <= cap) break;
    kept.delete(b.id);
    total -= b.compressedSizeBytes ?? 0;
  }

  return backups.filter((b) => !kept.has(b.id));
}
