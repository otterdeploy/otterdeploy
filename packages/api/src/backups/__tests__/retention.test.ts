/**
 * Residual storage-ceiling retention. GFS tiers (daily/weekly/monthly/yearly)
 * and the hard max-age cut now belong to `rustic forget` (driven by the
 * scheduler), so the only thing left here is the byte-ceiling selection:
 * `selectBackupsToPrune` picks the oldest survivors to drop until the total
 * fits `maxStorageGb`. These cases cover the ceiling, the no-policy guard, and
 * the null-size edge.
 */
import { describe, expect, it } from "vite-plus/test";

import { selectBackupsToPrune } from "../retention";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = Date.now();

/** N daily backups ending ~now, newest first (id = "d0" is the newest), 1 GB each. */
function daily(n: number, sizeBytes = 1_000_000_000) {
  return Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    completedAt: new Date(now - i * DAY - HOUR),
    compressedSizeBytes: sizeBytes,
  }));
}

describe("selectBackupsToPrune", () => {
  it("keeps everything when no ceiling is set", () => {
    expect(selectBackupsToPrune(daily(10), { maxStorageGb: null })).toHaveLength(0);
  });

  it("keeps everything when already under the ceiling", () => {
    expect(selectBackupsToPrune(daily(3), { maxStorageGb: 100 })).toHaveLength(0);
  });

  it("drops the oldest survivors until the total fits the ceiling", () => {
    // 10 × 1 GB = 10 GB; a 3 GB cap keeps the 3 newest and drops the 7 oldest.
    const pruned = selectBackupsToPrune(daily(10), { maxStorageGb: 3 });
    expect(pruned.map((b) => b.id).sort()).toEqual(
      ["d3", "d4", "d5", "d6", "d7", "d8", "d9"].sort(),
    );
  });

  it("treats missing sizes as zero (never pruned by the ceiling)", () => {
    const backups = daily(3).map((b) => ({ ...b, compressedSizeBytes: null }));
    expect(selectBackupsToPrune(backups, { maxStorageGb: 1 })).toHaveLength(0);
  });
});
