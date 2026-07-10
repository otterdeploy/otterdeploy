import { describe, expect, it } from "vite-plus/test";

import type { AggregateBucketRow } from "./project-aggregate";

import { chooseBucketSeconds, mergeAggregateBuckets } from "./project-aggregate";

const row = (over: Partial<AggregateBucketRow> = {}): AggregateBucketRow => ({
  bucketEpoch: 100,
  containerId: "c1",
  cpuPct: 10,
  memBytes: 1000,
  ...over,
});

describe("chooseBucketSeconds", () => {
  it("never goes finer than the 30s sampler cadence", () => {
    expect(chooseBucketSeconds(30)).toBe(30);
    expect(chooseBucketSeconds(1)).toBe(30);
  });

  it("scales the bucket up with the window (~120 buckets, 30s-aligned)", () => {
    expect(chooseBucketSeconds(60)).toBe(30); // 1h → 120 × 30s
    expect(chooseBucketSeconds(1440)).toBe(720); // 24h → 120 × 12m
    expect(chooseBucketSeconds(10080)).toBe(5040); // 7d → 120 × 84m
  });

  it("rounds odd windows up to a 30s multiple", () => {
    // 200m → 100s target → 120s buckets
    expect(chooseBucketSeconds(200)).toBe(120);
    expect(chooseBucketSeconds(200) % 30).toBe(0);
  });
});

describe("mergeAggregateBuckets", () => {
  it("sums container averages within a bucket and counts the reporters", () => {
    const points = mergeAggregateBuckets(
      [
        row({ containerId: "c1", cpuPct: 12.5, memBytes: 1_000 }),
        row({ containerId: "c2", cpuPct: 7.5, memBytes: 2_000 }),
      ],
      30,
    );
    expect(points).toEqual([
      { ts: new Date(100 * 30 * 1000), cpuPct: 20, memBytes: 3_000, containers: 2 },
    ]);
  });

  it("keeps buckets independent and sorts them ascending", () => {
    const points = mergeAggregateBuckets(
      [
        row({ bucketEpoch: 200, cpuPct: 5 }),
        row({ bucketEpoch: 100, cpuPct: 10 }),
        row({ bucketEpoch: 200, containerId: "c2", cpuPct: 1 }),
      ],
      60,
    );
    expect(points.map((p) => p.ts.getTime())).toEqual([100 * 60_000, 200 * 60_000]);
    expect(points.map((p) => p.cpuPct)).toEqual([10, 6]);
    expect(points.map((p) => p.containers)).toEqual([1, 2]);
  });

  it("omits unreported buckets instead of zero-filling them", () => {
    // Buckets 100 and 102 report; 101 is a genuine gap.
    const points = mergeAggregateBuckets(
      [row({ bucketEpoch: 100 }), row({ bucketEpoch: 102 })],
      30,
    );
    expect(points).toHaveLength(2);
    expect(points.some((p) => p.cpuPct === 0)).toBe(false);
  });

  it("returns an empty series for no rows", () => {
    expect(mergeAggregateBuckets([], 30)).toEqual([]);
  });

  it("reconstructs the bucket timestamp from the epoch ordinal and width", () => {
    const [point] = mergeAggregateBuckets([row({ bucketEpoch: 2_000_000 })], 720);
    expect(point?.ts.getTime()).toBe(2_000_000 * 720 * 1000);
  });
});
