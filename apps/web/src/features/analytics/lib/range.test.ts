import { describe, expect, test } from "vite-plus/test";

import { dayEndMs, dayStartMs, toEdgeWindow } from "./range";

// 2026-08-26T13:30:00 in Berlin (UTC+2 in August) = 11:30Z.
const NOW = Date.UTC(2026, 7, 26, 11, 30);
const TZ = "Europe/Berlin";

describe("day boundaries", () => {
  test("dayStartMs cuts at midnight in the given zone, not UTC", () => {
    // Berlin midnight on Aug 26 is 22:00Z on Aug 25.
    expect(dayStartMs(NOW, TZ)).toBe(Date.UTC(2026, 7, 25, 22));
    expect(dayStartMs(NOW, "UTC")).toBe(Date.UTC(2026, 7, 26));
  });

  test("dayEndMs clamps to now for the current day", () => {
    expect(dayEndMs(NOW, TZ, NOW)).toBe(NOW);
  });

  test("dayEndMs is the last ms of a past day", () => {
    const someYesterday = Date.UTC(2026, 7, 25, 9);
    expect(dayEndMs(someYesterday, "UTC", NOW)).toBe(Date.UTC(2026, 7, 26) - 1);
  });
});

describe("toEdgeWindow", () => {
  test("passes the shared presets straight through", () => {
    expect(toEdgeWindow("24h", undefined, undefined, TZ, NOW)).toEqual({ range: "24h" });
    expect(toEdgeWindow("7d", undefined, undefined, TZ, NOW)).toEqual({ range: "7d" });
    expect(toEdgeWindow("90d", undefined, undefined, TZ, NOW)).toEqual({ range: "90d" });
  });

  test("today becomes a custom window from local midnight to now", () => {
    expect(toEdgeWindow("today", undefined, undefined, TZ, NOW)).toEqual({
      range: "custom",
      from: Date.UTC(2026, 7, 25, 22),
      to: NOW,
    });
  });

  test("yesterday covers the full previous local day", () => {
    expect(toEdgeWindow("yesterday", undefined, undefined, TZ, NOW)).toEqual({
      range: "custom",
      from: Date.UTC(2026, 7, 24, 22),
      to: Date.UTC(2026, 7, 25, 22) - 1,
    });
  });

  test("long presets clamp to the widest edge window", () => {
    for (const range of ["6mo", "12mo", "all"] as const) {
      expect(toEdgeWindow(range, undefined, undefined, TZ, NOW)).toEqual({ range: "90d" });
    }
  });

  test("custom forwards its bounds, or falls back when they are missing", () => {
    expect(toEdgeWindow("custom", 1_000, 2_000, TZ, NOW)).toEqual({
      range: "custom",
      from: 1_000,
      to: 2_000,
    });
    expect(toEdgeWindow("custom", undefined, undefined, TZ, NOW)).toEqual({ range: "24h" });
  });
});
