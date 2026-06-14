/**
 * Grandfather-father-son (GFS) retention policy — the pure decision layer the
 * scheduler uses to decide which of a schedule's archives to prune. Modelled on
 * restic/borg `forget`: keep the most recent snapshot per bucket (day / week /
 * month / year) up to each tier's count, then enforce an optional hard max age
 * and a storage ceiling.
 *
 * Pure + side-effect free so it can be unit-tested and so the scheduler stays
 * focused on I/O. Input is newest-first; output is the subset to delete.
 */

export interface RetentionPolicy {
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepYearly: number;
  /** Hard max age in days — anything older is pruned even if a tier kept it. */
  retentionDays: number | null;
  /** Storage ceiling in GB — prune oldest survivors until total fits. */
  maxStorageGb: number | null;
}

export interface RetainableBackup {
  id: string;
  completedAt: Date | null;
  compressedSizeBytes: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function yearKey(d: Date): string {
  return String(d.getUTCFullYear());
}

/** ISO-8601 week key (YYYY-Www) — weeks start Monday, week 1 holds Jan 4th. */
function weekKey(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = date.getUTCDay() || 7; // Sun=0 → 7
  date.setUTCDate(date.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

interface Tier {
  keep: number;
  key: (d: Date) => string;
  last: string | null;
  kept: number;
}

/** Mark the ids kept by the count-based GFS tiers (newest-first input). */
function gfsKeptIds(backups: RetainableBackup[], policy: RetentionPolicy): Set<string> {
  const kept = new Set<string>();
  const tiers: Tier[] = [
    { keep: policy.keepDaily, key: dayKey, last: null, kept: 0 },
    { keep: policy.keepWeekly, key: weekKey, last: null, kept: 0 },
    { keep: policy.keepMonthly, key: monthKey, last: null, kept: 0 },
    { keep: policy.keepYearly, key: yearKey, last: null, kept: 0 },
  ];

  for (const b of backups) {
    // A run without a completion time hasn't earned a bucket — keep it to be safe.
    if (!b.completedAt) {
      kept.add(b.id);
      continue;
    }
    for (const tier of tiers) {
      if (tier.keep <= 0 || tier.kept >= tier.keep) continue;
      const k = tier.key(b.completedAt);
      if (k !== tier.last) {
        tier.last = k;
        tier.kept += 1;
        kept.add(b.id);
      }
    }
  }
  return kept;
}

/**
 * Decide which backups to prune. `backups` MUST be newest-first. With no
 * count tiers set the policy keeps everything by default (age/storage caps
 * still apply).
 */
export function selectBackupsToPrune<T extends RetainableBackup>(
  backups: T[],
  policy: RetentionPolicy,
): T[] {
  const hasTiers =
    policy.keepDaily > 0 ||
    policy.keepWeekly > 0 ||
    policy.keepMonthly > 0 ||
    policy.keepYearly > 0;

  const kept = hasTiers
    ? gfsKeptIds(backups, policy)
    : new Set(backups.map((b) => b.id));

  // Hard max age — drop kept archives older than the cutoff.
  if (policy.retentionDays != null) {
    const cutoff = Date.now() - policy.retentionDays * DAY_MS;
    for (const b of backups) {
      if (b.completedAt && b.completedAt.getTime() < cutoff) kept.delete(b.id);
    }
  }

  // Storage ceiling — drop oldest survivors until the total fits.
  if (policy.maxStorageGb != null) {
    const cap = policy.maxStorageGb * 1e9;
    const survivors = backups
      .filter((b) => kept.has(b.id))
      .sort(
        (a, c) =>
          (a.completedAt?.getTime() ?? 0) - (c.completedAt?.getTime() ?? 0),
      );
    let total = survivors.reduce((s, b) => s + (b.compressedSizeBytes ?? 0), 0);
    for (const b of survivors) {
      if (total <= cap) break;
      kept.delete(b.id);
      total -= b.compressedSizeBytes ?? 0;
    }
  }

  return backups.filter((b) => !kept.has(b.id));
}
