import { describe, expect, it } from "vite-plus/test";

import type { RequestSeriesLine } from "./request-series";

import { bucketRequestSeries, coveringRange } from "./request-series";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

const line = (agoMs: number, over: Partial<RequestSeriesLine> = {}): RequestSeriesLine => ({
  ts: new Date(NOW - agoMs).toISOString(),
  status: 200,
  latencyMs: 20,
  ...over,
});

describe("coveringRange", () => {
  it("picks the smallest store range that covers the window", () => {
    expect(coveringRange(5)).toBe("5m");
    expect(coveringRange(30)).toBe("1h");
    expect(coveringRange(60)).toBe("1h");
    expect(coveringRange(180)).toBe("6h");
    expect(coveringRange(720)).toBe("24h");
    expect(coveringRange(1440)).toBe("24h");
    expect(coveringRange(10080)).toBe("7d");
  });

  it("caps anything beyond retention at 7d", () => {
    expect(coveringRange(999_999)).toBe("7d");
  });
});

describe("bucketRequestSeries", () => {
  it("zero-fills counts across the whole window with null p95", () => {
    const { buckets, bucketSeconds } = bucketRequestSeries([], 60, NOW);
    expect(buckets).toHaveLength(40);
    expect(bucketSeconds).toBe(90); // 1h / 40
    for (const b of buckets) {
      expect(b.count).toBe(0);
      expect(b.errCount).toBe(0);
      expect(b.p95).toBeNull();
    }
    expect(buckets[0]?.t).toBe(new Date(NOW - 60 * 60_000).toISOString());
  });

  it("slots lines into the right buckets and counts errors", () => {
    // 1h window → 90s buckets. One ok + one 500 in the oldest bucket, one ok
    // in the newest.
    const { buckets } = bucketRequestSeries(
      [line(59 * 60_000), line(59 * 60_000, { status: 500 }), line(10_000, { status: 404 })],
      60,
      NOW,
    );
    expect(buckets[0]).toMatchObject({ count: 2, errCount: 1 });
    expect(buckets[39]).toMatchObject({ count: 1, errCount: 1 });
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(3);
  });

  it("computes per-bucket p95 with the ring's nearest-rank semantics", () => {
    // 20 latencies 5,10,…,100 in one bucket → rank floor(0.95*20)=19 → 100.
    const lines = Array.from({ length: 20 }, (_, i) => line(30_000, { latencyMs: (i + 1) * 5 }));
    const { buckets } = bucketRequestSeries(lines, 60, NOW);
    expect(buckets[39]?.p95).toBe(100);
  });

  it("drops lines older than the exact window (covering-range overfetch)", () => {
    // A 30m window fetched via the 1h store range: the 45m-old line is out.
    const { buckets } = bucketRequestSeries([line(45 * 60_000), line(60_000)], 30, NOW);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(1);
  });

  it("clamps a line exactly at `now` into the last bucket instead of dropping it", () => {
    const { buckets } = bucketRequestSeries([line(0)], 60, NOW);
    expect(buckets[39]?.count).toBe(1);
  });

  it("ignores lines with unparseable timestamps", () => {
    const { buckets } = bucketRequestSeries(
      [{ ts: "garbage", status: 200, latencyMs: 5 }],
      60,
      NOW,
    );
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(0);
  });
});
