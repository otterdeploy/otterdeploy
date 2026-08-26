import { describe, expect, test } from "vite-plus/test";

import { bucketFor, bucketStarts, resolveWindow, safeTimeZone } from "../query/window";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// 2026-08-26 12:00 UTC = 2026-08-26 08:00 in New York (EDT, UTC-4).
const NOW = Date.UTC(2026, 7, 26, 12, 0, 0);

describe("safeTimeZone", () => {
  test("keeps a valid IANA name and degrades an invalid one to UTC", () => {
    expect(safeTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
    expect(safeTimeZone("")).toBe("UTC");
  });
});

describe("resolveWindow: presets", () => {
  test("today is cut at midnight in the caller's timezone, not UTC", () => {
    const utc = resolveWindow({ range: "today", tz: "UTC", now: NOW });
    expect(utc.from).toBe(Date.UTC(2026, 7, 26, 0, 0, 0));
    expect(utc.to).toBe(NOW);

    const ny = resolveWindow({ range: "today", tz: "America/New_York", now: NOW });
    // NY midnight is 04:00 UTC during EDT.
    expect(ny.from).toBe(Date.UTC(2026, 7, 26, 4, 0, 0));
  });

  test("yesterday is the full previous local day", () => {
    const w = resolveWindow({ range: "yesterday", tz: "UTC", now: NOW });
    expect(w.from).toBe(Date.UTC(2026, 7, 25));
    expect(w.to).toBe(Date.UTC(2026, 7, 26));
  });

  test("24h is rolling (no midnight cut)", () => {
    const w = resolveWindow({ range: "24h", tz: "America/New_York", now: NOW });
    expect(w.from).toBe(NOW - DAY_MS);
    expect(w.to).toBe(NOW);
  });

  test("7d spans today plus the six previous local days", () => {
    const w = resolveWindow({ range: "7d", tz: "UTC", now: NOW });
    expect(w.from).toBe(Date.UTC(2026, 7, 20));
    expect(w.to).toBe(NOW);
  });

  test("6mo starts at the first of the month, five months back", () => {
    const w = resolveWindow({ range: "6mo", tz: "UTC", now: NOW });
    expect(w.from).toBe(Date.UTC(2026, 2, 1));
  });

  test("all starts at the 2020 floor (caller clamps to site creation)", () => {
    const w = resolveWindow({ range: "all", tz: "UTC", now: NOW });
    expect(w.from).toBe(Date.UTC(2020, 0, 1));
    expect(w.to).toBe(NOW);
  });

  test("custom uses the given epoch pair; missing pair falls back to 7d", () => {
    const from = NOW - 3 * DAY_MS;
    const w = resolveWindow({ range: "custom", from, to: NOW - DAY_MS, tz: "UTC", now: NOW });
    expect(w.from).toBe(from);
    expect(w.to).toBe(NOW - DAY_MS);

    const fallback = resolveWindow({ range: "custom", tz: "UTC", now: NOW });
    expect(fallback.from).toBe(Date.UTC(2026, 7, 20));
  });
});

describe("resolveWindow: previous window", () => {
  test("is the same length immediately before", () => {
    const w = resolveWindow({ range: "30d", tz: "UTC", now: NOW });
    const span = w.to - w.from;
    expect(w.previous.to).toBe(w.from);
    expect(w.previous.from).toBe(w.from - span);
  });
});

describe("bucket selection", () => {
  test("span thresholds: 2 days, 92 days, 400 days", () => {
    expect(bucketFor(2 * DAY_MS)).toBe("hour");
    expect(bucketFor(2 * DAY_MS + 1)).toBe("day");
    expect(bucketFor(92 * DAY_MS)).toBe("day");
    expect(bucketFor(92 * DAY_MS + 1)).toBe("week");
    expect(bucketFor(400 * DAY_MS)).toBe("week");
    expect(bucketFor(400 * DAY_MS + 1)).toBe("month");
  });

  test("presets pick the expected bucket", () => {
    expect(resolveWindow({ range: "today", tz: "UTC", now: NOW }).bucket).toBe("hour");
    expect(resolveWindow({ range: "30d", tz: "UTC", now: NOW }).bucket).toBe("day");
    expect(resolveWindow({ range: "12mo", tz: "UTC", now: NOW }).bucket).toBe("week");
  });
});

describe("bucketStarts", () => {
  test("hour buckets align to the hour and cover the window", () => {
    const from = Date.UTC(2026, 7, 26, 9, 30, 0);
    const starts = bucketStarts(from, NOW, "hour", "UTC", NOW);
    expect(starts[0]).toBe(Date.UTC(2026, 7, 26, 9, 0, 0));
    expect(starts.at(-1)).toBe(Date.UTC(2026, 7, 26, 11, 0, 0));
    expect(starts).toHaveLength(3);
  });

  test("never emits a bucket past now, even for a future `to`", () => {
    const starts = bucketStarts(NOW - 2 * HOUR_MS, NOW + DAY_MS, "hour", "UTC", NOW);
    for (const s of starts) expect(s).toBeLessThan(NOW);
    expect(starts.at(-1)).toBe(Date.UTC(2026, 7, 26, 11, 0, 0));
  });

  test("the still-running current bucket IS included", () => {
    const starts = bucketStarts(Date.UTC(2026, 7, 26, 0, 0, 0), NOW, "day", "UTC", NOW);
    expect(starts).toEqual([Date.UTC(2026, 7, 26)]);
  });

  test("day buckets cut at local midnight", () => {
    const from = Date.UTC(2026, 7, 25, 12, 0, 0);
    const starts = bucketStarts(from, NOW, "day", "America/New_York", NOW);
    // Local midnights: Aug 25 and Aug 26 (04:00 UTC each in EDT).
    expect(starts).toEqual([Date.UTC(2026, 7, 25, 4), Date.UTC(2026, 7, 26, 4)]);
  });

  test("week buckets start on ISO Monday, like date_trunc('week')", () => {
    // 2026-08-26 is a Wednesday; the containing week starts Mon 2026-08-24.
    const starts = bucketStarts(NOW - DAY_MS, NOW, "week", "UTC", NOW);
    expect(starts).toEqual([Date.UTC(2026, 7, 24)]);
  });

  test("month buckets start on the first", () => {
    const starts = bucketStarts(Date.UTC(2026, 6, 10), NOW, "month", "UTC", NOW);
    expect(starts).toEqual([Date.UTC(2026, 6, 1), Date.UTC(2026, 7, 1)]);
  });

  test("an empty window yields no buckets", () => {
    expect(bucketStarts(NOW, NOW, "hour", "UTC", NOW)).toHaveLength(0);
  });
});
