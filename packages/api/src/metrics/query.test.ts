import { describe, expect, it } from "vite-plus/test";

import type { ResourceBucketRow } from "./query";

import { chooseResourceBucketSeconds, mergeResourceBuckets } from "./query";

const row = (over: Partial<ResourceBucketRow> = {}): ResourceBucketRow => ({
  bucketEpoch: 100,
  containerId: "c1",
  cpuPct: 10,
  memBytes: 1000,
  memLimitBytes: 8000,
  netRxBytes: 500,
  netTxBytes: 250,
  ...over,
});

describe("chooseResourceBucketSeconds", () => {
  it("never goes finer than the 30s sampler cadence", () => {
    expect(chooseResourceBucketSeconds(10)).toBe(30);
    expect(chooseResourceBucketSeconds(1)).toBe(30);
  });

  it("scales with the window (~240 buckets, 30s-aligned)", () => {
    expect(chooseResourceBucketSeconds(120)).toBe(30); // 2h → 240 × 30s
    expect(chooseResourceBucketSeconds(1440)).toBe(360); // 24h → 240 × 6m
    expect(chooseResourceBucketSeconds(200) % 30).toBe(0);
  });
});

describe("mergeResourceBuckets", () => {
  it("sums a replica set into one point per bucket", () => {
    // The bug this exists for: two containers reporting at one instant used to
    // reach the chart as two points at the same x, drawn as a vertical spike.
    const points = mergeResourceBuckets(
      [
        row({ containerId: "c1", cpuPct: 12.5, memBytes: 1_000, netRxBytes: 100 }),
        row({ containerId: "c2", cpuPct: 7.5, memBytes: 2_000, netRxBytes: 400 }),
      ],
      30,
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      cpuPct: 20,
      memBytes: 3_000,
      netRxBytes: 500,
      containers: 2,
    });
  });

  it("dates each bucket from its ordinal and sorts ascending", () => {
    const points = mergeResourceBuckets([row({ bucketEpoch: 3 }), row({ bucketEpoch: 1 })], 60);
    expect(points.map((p) => p.ts.getTime())).toEqual([60_000, 180_000]);
  });

  it("omits a bucket nobody reported rather than zero-filling it", () => {
    const points = mergeResourceBuckets([row({ bucketEpoch: 1 }), row({ bucketEpoch: 5 })], 30);
    expect(points.map((p) => p.containers)).toEqual([1, 1]);
    expect(points).toHaveLength(2);
  });
});
