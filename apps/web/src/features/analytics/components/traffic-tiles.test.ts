import { Temporal } from "@otterdeploy/shared/temporal";
import { describe, expect, it } from "vite-plus/test";

import { trafficTiles } from "./analytics-view-parts";

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

const bucket = (t: string, requests: number) => ({
  t,
  requests,
  s4xx: 0,
  s5xx: 0,
  resBytes: requests * 512,
  p95: null,
});

describe("trafficTiles", () => {
  // Zero is a measurement claim. When collection is off nothing was measured,
  // so five tiles reading "0" and "0.00%" assert something the install cannot
  // know — the same distinction analytics-query.ts draws for its series
  // ("0 requests is a real measurement, a gap is not").
  it("blanks every value when nothing is being measured", () => {
    const tiles = trafficTiles(summary, [], previous, false);
    expect(tiles).toHaveLength(5);
    expect(tiles.map((t) => t.value)).toEqual(["–", "–", "–", "–", "–"]);
  });

  it("keeps the tile keys so the page still says what it reports", () => {
    const tiles = trafficTiles(summary, [], previous, false);
    expect(tiles.map((t) => t.key)).toEqual([
      "requests",
      "visitorDays",
      "bandwidth",
      "latency",
      "errorRate",
    ]);
    // The explanatory hovers survive: they describe the metric, not a reading.
    expect(tiles[1]?.help).toBe("visitorDays");
    expect(tiles[3]?.help).toBe("latency");
  });

  // A trend delta against a number nobody took is meaningless, and a sparkline
  // of zeros draws a flat line that reads as a real quiet period.
  it("drops deltas and sparklines when not measuring", () => {
    for (const tile of trafficTiles(summary, [], previous, false)) {
      expect(tile.delta).toBeNull();
      expect(tile.spark).toBeUndefined();
      expect(tile.sub).toBeUndefined();
    }
  });

  // Once collection is running, zero is the truth and must render as zero.
  it("reports real zeros when the install IS measuring", () => {
    const tiles = trafficTiles(summary, [], previous, true);
    expect(tiles[0]?.value).toBe("0");
    expect(tiles[4]?.value).toBe("0.00%");
  });

  it("judges latency and error deltas as good when they fall", () => {
    const tiles = trafficTiles(
      { ...summary, requests: 1_000, p95: 80, errorRate: 0.01 },
      [],
      { ...previous, requests: 800, p95: 100, errorRate: 0.02 },
      true,
    );
    expect(tiles[0]?.delta).toEqual({ text: "↑ 25%", tone: "up", good: true });
    expect(tiles[3]?.delta).toEqual({ text: "↓ 20%", tone: "down", good: true });
    expect(tiles[4]?.delta).toEqual({ text: "↓ 50%", tone: "down", good: true });
  });

  // A null percentile is a bucket with no requests: a break in the spark,
  // never a zero-latency reading; a bad timestamp is dropped, never guessed.
  it("builds sparklines through Temporal and skips null readings", () => {
    const series = [
      bucket("2026-08-25T00:00:00Z", 10),
      { ...bucket("2026-08-25T01:00:00Z", 20), p95: 42 },
      bucket("not a timestamp", 30),
    ];
    const tiles = trafficTiles({ ...summary, requests: 60 }, series, previous, true);
    expect(tiles[0]?.spark?.map((r) => r.value)).toEqual([10, 20]);
    expect(tiles[3]?.spark).toEqual([
      { ts: Temporal.Instant.from("2026-08-25T01:00:00Z").epochMilliseconds, value: 42 },
    ]);
    expect(tiles[0]?.sub).toEqual({ kind: "bots", share: "0.0%" });
  });
});
