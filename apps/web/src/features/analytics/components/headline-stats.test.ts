import { describe, expect, it } from "vite-plus/test";

import { headlineStats } from "./analytics-view-parts";

const summary = {
  requests: 0,
  botRequests: 0,
  visitorDays: 0,
  peakDayVisitors: 0,
  bytesOut: 0,
  p95: null,
  avgLatencyMs: null,
  errorRate: 0,
  hostCount: 0,
};

const previous = { requests: 0, visitorDays: 0, bytesOut: 0, p95: null, errorRate: 0 };

describe("headlineStats", () => {
  // Zero is a measurement claim. When collection is off nothing was measured,
  // so five tiles reading "0" and "0.00%" assert something the install cannot
  // know — the same distinction analytics-query.ts draws for its series
  // ("0 requests is a real measurement, a gap is not").
  it("blanks every value when nothing is being measured", () => {
    const tiles = headlineStats(summary, [], previous, false);
    expect(tiles).toHaveLength(5);
    expect(tiles.map((t) => t.value)).toEqual(["–", "–", "–", "–", "–"]);
  });

  it("keeps the labels so the page still says what it reports", () => {
    const tiles = headlineStats(summary, [], previous, false);
    expect(tiles.map((t) => t.label)).toEqual([
      "Requests",
      "Visitor-days",
      "Bandwidth out",
      "Latency",
      "Error rate",
    ]);
  });

  // A trend delta against a number nobody took is meaningless, and a sparkline
  // of zeros draws a flat line that reads as a real quiet period.
  it("drops deltas and sparklines when not measuring", () => {
    for (const tile of headlineStats(summary, [], previous, false)) {
      expect(tile.delta).toBeUndefined();
      expect(tile.spark).toBeUndefined();
    }
  });

  // Once collection is running, zero is the truth and must render as zero.
  it("reports real zeros when the install IS measuring", () => {
    const tiles = headlineStats(summary, [], previous, true);
    expect(tiles[0]?.value).toBe("0");
    expect(tiles[4]?.value).toBe("0.00%");
  });
});
