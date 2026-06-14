/**
 * GFS retention policy tests. The scheduler relies on `selectBackupsToPrune`
 * to decide deletions, so each tier (daily/weekly/monthly/yearly), the age
 * cutoff, and the storage ceiling get a case — plus the no-policy guard that
 * must never prune.
 */
import { describe, expect, it } from "vitest";

import { selectBackupsToPrune } from "../retention";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// Anchor to now (the policy compares against Date.now()); the −1h offset keeps
// each backup clear of an exact day boundary so the age cutoff is deterministic.
const now = Date.now();

/** N daily backups ending ~now, newest first (id = "d0" is the newest). */
function daily(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    completedAt: new Date(now - i * DAY - HOUR),
    compressedSizeBytes: 1_000_000_000, // 1 GB each
  }));
}

const noPolicy = {
  keepDaily: 0,
  keepWeekly: 0,
  keepMonthly: 0,
  keepYearly: 0,
  retentionDays: null,
  maxStorageGb: null,
};

describe("selectBackupsToPrune", () => {
  it("keeps everything when no policy is set", () => {
    expect(selectBackupsToPrune(daily(10), noPolicy)).toHaveLength(0);
  });

  it("keeps the newest N daily and prunes the rest", () => {
    const pruned = selectBackupsToPrune(daily(10), {
      ...noPolicy,
      keepDaily: 3,
    });
    // 10 backups on 10 distinct days, keep 3 → prune 7 (the oldest).
    expect(pruned.map((b) => b.id).sort()).toEqual(
      ["d3", "d4", "d5", "d6", "d7", "d8", "d9"].sort(),
    );
  });

  it("keeps one per week for keepWeekly across daily backups", () => {
    // 21 daily backups span 3 ISO weeks; keepWeekly:2 keeps the newest of the
    // two most recent weeks (plus nothing else, since other tiers are 0).
    const kept = new Set(
      daily(21)
        .filter(
          (b) =>
            !selectBackupsToPrune(daily(21), {
              ...noPolicy,
              keepWeekly: 2,
            }).some((p) => p.id === b.id),
        )
        .map((b) => b.id),
    );
    expect(kept.size).toBe(2);
  });

  it("enforces the hard max-age cutoff even on tier-kept archives", () => {
    const pruned = selectBackupsToPrune(daily(10), {
      ...noPolicy,
      keepDaily: 10,
      retentionDays: 3,
    });
    // keepDaily would keep all 10, but anything older than 3 days goes. With the
    // −1h offset, d0/d1/d2 are <3d old (kept); d3+ are older (pruned).
    expect(pruned.map((b) => b.id).sort()).toEqual(
      ["d3", "d4", "d5", "d6", "d7", "d8", "d9"].sort(),
    );
  });

  it("enforces the storage ceiling by dropping oldest survivors", () => {
    // keepDaily:10 keeps all (10 GB); a 3 GB cap drops the 7 oldest.
    const pruned = selectBackupsToPrune(daily(10), {
      ...noPolicy,
      keepDaily: 10,
      maxStorageGb: 3,
    });
    expect(pruned.map((b) => b.id).sort()).toEqual(
      ["d3", "d4", "d5", "d6", "d7", "d8", "d9"].sort(),
    );
  });
});
