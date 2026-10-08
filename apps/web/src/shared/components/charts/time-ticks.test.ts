/**
 * The tick step is chosen first and the label follows from it.
 *
 * The live tour found two axes repeating themselves: the
 * Analytics visitors chart read `Oct 1 · Oct 2 · Oct 2 · Oct 3 · Oct 3` and
 * the Edge histogram `04:32 · 04:33 · 04:33 · 04:34 · 04:34`. Both came from
 * ticks finer than their labels. These tests hold the property that rules
 * that out, at the widths and windows those two charts actually draw.
 */
import { Temporal } from "@otterdeploy/shared/temporal";
import { describe, expect, it } from "vite-plus/test";

import { bucketTicks, tickBudget, timeTicks } from "./time-ticks";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 2026-10-08 06:48 in Berlin (04:48 UTC), the tour's own clock. */
const NOW = Temporal.Instant.from("2026-10-08T04:48:00Z").epochMilliseconds;

function labels(startMs: number, endMs: number, maxTicks: number, zone: string, minStepMs = 0) {
  const ticks = timeTicks(startMs, endMs, { maxTicks, zone, minStepMs });
  return { ticks, text: ticks.values.map((ms) => ticks.label(ms)) };
}

function adjacentRepeats(text: readonly string[]): string[] {
  return text.filter((label, i) => i > 0 && label === text[i - 1]);
}

describe("timeTicks", () => {
  it("never repeats a day label on a seven-day axis, at any width", () => {
    const start = Temporal.Instant.from("2026-09-30T22:00:00Z").epochMilliseconds; // Oct 1, Berlin
    for (const width of [320, 600, 1100, 1600]) {
      const { text } = labels(start, start + 7 * DAY, tickBudget(width, 90), "Europe/Berlin");
      expect(adjacentRepeats(text)).toEqual([]);
      // A wide axis may tick at noon too, but each DATE appears once: the
      // dates are the midnights, and a clock label sits between them.
      const dates = text.filter((label) => !label.includes(":"));
      expect(new Set(dates).size).toBe(dates.length);
    }
  });

  it("never ticks between the buckets of a daily series", () => {
    const start = Temporal.Instant.from("2026-09-30T22:00:00Z").epochMilliseconds;
    const { text } = labels(start, start + 7 * DAY, tickBudget(1600, 90), "Europe/Berlin", DAY);
    expect(text.some((label) => label.includes(":"))).toBe(false);
    expect(new Set(text).size).toBe(text.length);
  });

  it("labels the Analytics week as dates on local midnights", () => {
    const start = Temporal.Instant.from("2026-09-30T22:00:00Z").epochMilliseconds;
    const { ticks, text } = labels(start, start + 7 * DAY, 12, "Europe/Berlin");
    expect(text).toEqual(["Oct 1", "Oct 2", "Oct 3", "Oct 4", "Oct 5", "Oct 6", "Oct 7", "Oct 8"]);
    for (const ms of ticks.values) {
      const local = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO("Europe/Berlin");
      expect([local.hour, local.minute]).toEqual([0, 0]);
    }
  });

  it("never repeats a minute label on the Edge histogram's sixteen minutes", () => {
    // 30-second buckets, sixteen minutes, ~1180px of plot at 110px a label.
    const start = NOW - 16 * MINUTE;
    const { ticks, text } = labels(start, NOW, tickBudget(1180, 110), "UTC", 30_000);
    expect(adjacentRepeats(text)).toEqual([]);
    expect(new Set(text).size).toBe(text.length);
    // Whole minutes, not half-minutes labelled as minutes.
    for (const ms of ticks.values) expect(ms % MINUTE).toBe(0);
  });

  it("drops to seconds only when the step itself is under a minute", () => {
    const { text } = labels(NOW - 2 * MINUTE, NOW, 8, "UTC");
    expect(text.every((label) => label.split(":").length === 3)).toBe(true);
    expect(adjacentRepeats(text)).toEqual([]);
  });

  it("names the day where an hour axis crosses midnight", () => {
    const end = Temporal.Instant.from("2026-10-08T04:00:00Z").epochMilliseconds;
    const { text } = labels(end - 12 * HOUR, end, 8, "UTC");
    expect(text).toContain("Oct 8");
    expect(text).not.toContain("00:00");
    expect(adjacentRepeats(text)).toEqual([]);
  });

  it("aligns to the zone it prints in, including half-hour offsets", () => {
    // St. John's is UTC-2:30 in October: a UTC-aligned hour would print :30.
    const { ticks, text } = labels(NOW - 6 * HOUR, NOW, 6, "America/St_Johns");
    expect(text.length).toBeGreaterThan(2);
    for (const ms of ticks.values) {
      const local =
        Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO("America/St_Johns");
      expect(local.minute).toBe(0);
    }
  });

  it("keeps ticks unique and ascending across a DST change", () => {
    // Europe/Berlin falls back at 03:00 local on 2026-10-25.
    const start = Temporal.Instant.from("2026-10-24T22:00:00Z").epochMilliseconds;
    const { ticks, text } = labels(start, start + DAY, 12, "Europe/Berlin");
    for (let i = 1; i < ticks.values.length; i++) {
      expect(ticks.values[i]).toBeGreaterThan(ticks.values[i - 1]);
    }
    expect(adjacentRepeats(text)).toEqual([]);
  });

  it("stays inside the window and within the budget", () => {
    for (const span of [5 * MINUTE, 3 * HOUR, 2 * DAY, 30 * DAY, 400 * DAY]) {
      const { ticks } = labels(NOW - span, NOW, 6, "Europe/Berlin");
      expect(ticks.values.length).toBeGreaterThan(0);
      // A calendar step can land one over the approximate budget at the edges.
      expect(ticks.values.length).toBeLessThanOrEqual(8);
      for (const ms of ticks.values) {
        expect(ms).toBeGreaterThanOrEqual(NOW - span);
        expect(ms).toBeLessThanOrEqual(NOW);
      }
    }
  });

  it("gives an empty window one tick, not a loop", () => {
    expect(timeTicks(NOW, NOW, { maxTicks: 6, zone: "UTC" }).values).toEqual([NOW]);
  });
});

describe("bucketTicks", () => {
  // The Edge histogram from the tour: 30-second buckets from 04:32:30 to
  // 04:48:30 UTC, ~1180px wide. It read `04:32 04:33 04:33 04:34 04:34 …`.
  const BUCKET = 30_000;
  const first = Temporal.Instant.from("2026-10-08T04:32:30Z").epochMilliseconds;
  const starts = Array.from({ length: 33 }, (_, i) => first + i * BUCKET);

  it("labels each tick once, on a bucket that contains the labelled minute", () => {
    const ticks = bucketTicks(starts, BUCKET, { maxTicks: tickBudget(1180, 110), zone: "UTC" });
    const text = ticks.values.map((start) => ticks.label(start));
    expect(adjacentRepeats(text)).toEqual([]);
    expect(new Set(text).size).toBe(text.length);
    for (const start of ticks.values) expect(starts).toContain(start);
    // The bucket starting 04:35:00 carries "04:35"; nothing carries it twice.
    expect(text).toContain("04:36");
  });

  it("pins a tick to the bucket containing it when buckets are offset", () => {
    const offset = starts.map((start) => start + 10_000); // 04:32:40, 04:33:10, …
    const ticks = bucketTicks(offset, BUCKET, { maxTicks: 4, zone: "UTC" });
    for (const start of ticks.values) {
      const label = ticks.label(start);
      const [hh, mm] = label.split(":").map(Number);
      const labelled = Temporal.Instant.from(
        `2026-10-08T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`,
      ).epochMilliseconds;
      expect(labelled).toBeGreaterThanOrEqual(start);
      expect(labelled).toBeLessThan(start + BUCKET);
    }
  });

  it("has nothing to tick without buckets", () => {
    expect(bucketTicks([], BUCKET, { maxTicks: 6 }).values).toEqual([]);
  });
});
