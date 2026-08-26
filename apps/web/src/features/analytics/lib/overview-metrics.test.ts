import { describe, expect, test } from "vite-plus/test";

import { bucketIntervalMs, METRIC_DEFS, metricDelta, toChartRows } from "./overview-metrics";

const totals = {
  visitors: 1_240,
  pageviews: 5_130,
  sessions: 1_400,
  bounceRate: 0.427,
  avgDurationMs: 84_000,
  viewsPerVisit: 3.66,
  conversions: 12,
};

describe("METRIC_DEFS", () => {
  test("reads and formats each tile metric", () => {
    expect(METRIC_DEFS.visitors.format(totals.visitors)).toBe("1.2K");
    expect(METRIC_DEFS.bounceRate.format(0.427)).toBe("43%");
    expect(METRIC_DEFS.avgDuration.format(84_000)).toBe("1m 24s");
    expect(METRIC_DEFS.viewsPerVisit.format(3.66)).toBe("3.66");
    expect(METRIC_DEFS.viewsPerVisit.format(4)).toBe("4");
  });

  test("null readings pass through as null, never zero", () => {
    expect(METRIC_DEFS.bounceRate.read({ ...totals, bounceRate: null })).toBeNull();
    expect(METRIC_DEFS.avgDuration.read({ ...totals, avgDurationMs: null })).toBeNull();
  });

  test("only the counted metrics chart over time", () => {
    expect(METRIC_DEFS.visitors.seriesKey).toBe("visitors");
    expect(METRIC_DEFS.bounceRate.seriesKey).toBeNull();
    expect(METRIC_DEFS.avgDuration.seriesKey).toBeNull();
  });
});

describe("metricDelta", () => {
  test("rises and falls with sign and rounding", () => {
    expect(metricDelta(112, 100, false)).toEqual({ text: "↑ 12%", tone: "up", good: true });
    expect(metricDelta(88, 100, false)).toEqual({ text: "↓ 12%", tone: "down", good: false });
  });

  test("bounce rate inverts what counts as good", () => {
    expect(metricDelta(0.3, 0.4, true)).toMatchObject({ tone: "down", good: true });
    expect(metricDelta(0.5, 0.4, true)).toMatchObject({ tone: "up", good: false });
  });

  test("movement under half a percent reads flat", () => {
    expect(metricDelta(1_004, 1_000, false)).toEqual({ text: "±0%", tone: "flat", good: true });
  });

  test("absent or zero previous yields no delta at all", () => {
    expect(metricDelta(100, null, false)).toBeNull();
    expect(metricDelta(null, 100, false)).toBeNull();
    expect(metricDelta(100, 0, false)).toBeNull();
  });
});

describe("toChartRows", () => {
  const series = [
    { t: "2026-08-24T00:00:00Z", visitors: 4, pageviews: 9, sessions: 5 },
    { t: "2026-08-25T00:00:00Z", visitors: 0, pageviews: 0, sessions: 0 },
  ];

  test("maps ISO buckets to epoch-ms rows for the chosen series", () => {
    const rows = toChartRows(series, "pageviews");
    expect(rows).toEqual([
      { ts: Date.UTC(2026, 7, 24), value: 9 },
      { ts: Date.UTC(2026, 7, 25), value: 0 },
    ]);
  });

  test("drops an unparseable bucket instead of guessing", () => {
    const rows = toChartRows(
      [...series, { t: "not-a-time", visitors: 1, pageviews: 1, sessions: 1 }],
      "visitors",
    );
    expect(rows).toHaveLength(2);
  });
});

describe("bucketIntervalMs", () => {
  test("matches the API's bucket ladder", () => {
    expect(bucketIntervalMs("hour")).toBe(3_600_000);
    expect(bucketIntervalMs("day")).toBe(86_400_000);
    expect(bucketIntervalMs("week")).toBe(604_800_000);
    expect(bucketIntervalMs("month")).toBe(31 * 86_400_000);
  });
});
