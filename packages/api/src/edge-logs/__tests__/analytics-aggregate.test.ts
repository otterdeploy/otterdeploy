import { describe, expect, test } from "vite-plus/test";

import type { AnalyticsLine, DayAcc, MinuteAcc } from "../aggregate";

import { foldLine, OVERFLOW_KEY, PATHS_PER_DAY_CAP, VISITOR_HASH_CAP } from "../aggregate";
import { percentileFromBuckets } from "../analytics-query";

function line(over: Partial<AnalyticsLine> = {}): AnalyticsLine {
  return {
    ts: "2026-08-16T12:00:30.000Z",
    host: "app.example.com",
    path: "/",
    status: 200,
    latencyMs: 12,
    clientIp: "203.0.113.7",
    country: "DE",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    referer: "-",
    reqBytes: 100,
    resBytes: 5_000,
    ...over,
  };
}

interface Maps {
  minutes: Map<string, MinuteAcc>;
  days: Map<string, DayAcc>;
  visitorSeen: Map<string, Set<bigint>>;
  visitorHashCount: number;
  salt: string;
}

function newMaps(): Maps {
  return {
    minutes: new Map(),
    days: new Map(),
    visitorSeen: new Map(),
    visitorHashCount: 0,
    salt: "test-salt",
  };
}

function fold(maps: Maps, lines: AnalyticsLine[]): void {
  for (const l of lines) maps.visitorHashCount = foldLine(maps, l);
}

function onlyDay(maps: Maps): DayAcc {
  const acc = [...maps.days.values()][0];
  if (!acc) throw new Error("expected a day acc");
  return acc;
}

function onlyMinute(maps: Maps): MinuteAcc {
  const acc = [...maps.minutes.values()][0];
  if (!acc) throw new Error("expected a minute acc");
  return acc;
}

describe("foldLine", () => {
  test("one line lands in exactly one minute and one day acc", () => {
    const maps = newMaps();
    fold(maps, [line()]);
    const m = onlyMinute(maps);
    expect(m.minute).toBe(Math.floor(Date.parse("2026-08-16T12:00:30.000Z") / 60_000));
    expect(m.requests).toBe(1);
    expect(m.s2xx).toBe(1);
    expect(m.resBytes).toBe(5_000);
    const d = onlyDay(maps);
    expect(d.day).toBe("20260816");
    expect(d.requests).toBe(1);
    expect(d.statuses).toEqual({ "200": 1 });
    expect(d.visitors).toBe(1);
    expect(d.countries).toEqual({ DE: 1 });
  });

  test("minute boundaries split accs; the day acc spans them", () => {
    const maps = newMaps();
    fold(maps, [
      line({ ts: "2026-08-16T12:00:59.000Z" }),
      line({ ts: "2026-08-16T12:01:01.000Z" }),
    ]);
    expect(maps.minutes.size).toBe(2);
    expect(maps.days.size).toBe(1);
    expect(onlyDay(maps).requests).toBe(2);
  });

  test("same IP twice is one visitor; a bot is none", () => {
    const maps = newMaps();
    fold(maps, [
      line(),
      line({ ts: "2026-08-16T13:00:00.000Z" }),
      line({ clientIp: "198.51.100.9", userAgent: "curl/8.4.0" }),
    ]);
    const d = onlyDay(maps);
    expect(d.requests).toBe(3);
    expect(d.botRequests).toBe(1);
    expect(d.visitors).toBe(1);
  });

  test("the same IP counts again on a new day (per-day distinct)", () => {
    const maps = newMaps();
    fold(maps, [line(), line({ ts: "2026-08-17T00:00:01.000Z" })]);
    expect(maps.days.size).toBe(2);
    const total = [...maps.days.values()].reduce((n, d) => n + d.visitors, 0);
    expect(total).toBe(2);
  });

  test("status classes split, oddballs count apart without vanishing", () => {
    const maps = newMaps();
    fold(maps, [
      line({ status: 204 }),
      line({ status: 301 }),
      line({ status: 404 }),
      line({ status: 502 }),
      line({ status: 0 }),
      line({ status: 999 }),
    ]);
    const m = onlyMinute(maps);
    expect([m.s2xx, m.s3xx, m.s4xx, m.s5xx, m.sOther]).toEqual([1, 1, 1, 1, 2]);
    const d = onlyDay(maps);
    expect(d.statuses["0"]).toBe(2);
  });

  test("paths normalize and cap into the overflow bucket", () => {
    const maps = newMaps();
    fold(maps, [line({ path: "/orders/123?tab=x" })]);
    expect(onlyDay(maps).paths).toEqual({ "/orders/:id": 1 });

    const flood: AnalyticsLine[] = [];
    for (let i = 0; i < PATHS_PER_DAY_CAP + 50; i++) {
      flood.push(line({ path: `/p${i}/x` }));
    }
    fold(maps, flood);
    const d = onlyDay(maps);
    // +1 for the overflow key itself; the original path took one slot, so one
    // extra flood path spills over alongside the 50 past the cap.
    expect(Object.keys(d.paths).length).toBe(PATHS_PER_DAY_CAP + 1);
    expect(d.paths[OVERFLOW_KEY]).toBe(51);
  });

  test("referrers keep external hosts only", () => {
    const maps = newMaps();
    fold(maps, [
      line({ referer: "https://news.ycombinator.com/item" }),
      line({ referer: "https://app.example.com/self" }),
      line({ referer: "-" }),
    ]);
    expect(onlyDay(maps).referrers).toEqual({ "news.ycombinator.com": 1 });
  });

  test("visitor cap stops counting and flags approximate, honestly", () => {
    const maps = newMaps();
    maps.visitorHashCount = VISITOR_HASH_CAP; // simulate a full estate
    fold(maps, [line({ clientIp: "198.51.100.50" })]);
    const d = onlyDay(maps);
    expect(d.visitors).toBe(0);
    expect(d.approximate).toBe(true);
  });

  test("latency histogram + max are recorded per minute", () => {
    const maps = newMaps();
    fold(maps, [line({ latencyMs: 3 }), line({ latencyMs: 900 }), line({ latencyMs: 9_000 })]);
    const m = onlyMinute(maps);
    expect(m.latencyBuckets[2]).toBe(1); // ≤5ms
    expect(m.latencyBuckets[9]).toBe(1); // ≤1000ms
    expect(m.latencyBuckets[12]).toBe(1); // overflow
    expect(m.latencyMaxMs).toBe(9_000);
    expect(m.latencySumMs).toBe(9_903);
  });

  test("an unparseable timestamp is dropped, not misfiled", () => {
    const maps = newMaps();
    fold(maps, [line({ ts: "not-a-date" })]);
    expect(maps.minutes.size).toBe(0);
    expect(maps.days.size).toBe(0);
  });
});

describe("percentileFromBuckets", () => {
  test("empty histogram has no percentile", () => {
    expect(percentileFromBuckets(new Array<number>(13).fill(0), 0.95)).toBeNull();
  });

  test("a single-bucket histogram interpolates within that bucket's bounds", () => {
    const buckets = new Array<number>(13).fill(0);
    buckets[6] = 100; // (50, 100] ms
    const p50 = percentileFromBuckets(buckets, 0.5);
    const p99 = percentileFromBuckets(buckets, 0.99);
    expect(p50).toBeGreaterThan(50);
    expect(p50).toBeLessThanOrEqual(100);
    expect(p99).toBeGreaterThan(p50 ?? 0);
    expect(p99).toBeLessThanOrEqual(100);
  });

  test("overflow-only traffic reads as ≥5000, clamped", () => {
    const buckets = new Array<number>(13).fill(0);
    buckets[12] = 10;
    const p95 = percentileFromBuckets(buckets, 0.95);
    expect(p95).toBeGreaterThanOrEqual(5_000);
    expect(p95).toBeLessThanOrEqual(10_000);
  });

  test("split distribution puts the median at the boundary bucket", () => {
    const buckets = new Array<number>(13).fill(0);
    buckets[0] = 50; // ≤1ms
    buckets[12] = 50; // overflow
    const p50 = percentileFromBuckets(buckets, 0.5);
    expect(p50).toBeLessThanOrEqual(1);
    const p95 = percentileFromBuckets(buckets, 0.95);
    expect(p95).toBeGreaterThanOrEqual(5_000);
  });
});
