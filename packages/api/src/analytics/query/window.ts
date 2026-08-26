/**
 * Time-window resolution for the analytics query API. Pure: `now` is always a
 * parameter, so every rule here is unit-testable without a clock.
 *
 * Day-based presets are cut at MIDNIGHT IN THE CALLER'S TIMEZONE (a "today"
 * that starts at UTC midnight is wrong for everyone west or east of London);
 * `24h` is the one deliberately rolling window. The SQL side buckets with
 * `date_trunc(unit, ts AT TIME ZONE tz)`; `bucketStarts` reproduces the same
 * bucket boundaries in JS so series can be zero-filled up to now, never into
 * the future. Design: docs/designs/web-analytics.md §6.
 */

import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";

export const RANGE_PRESETS = [
  "today",
  "yesterday",
  "24h",
  "7d",
  "30d",
  "90d",
  "6mo",
  "12mo",
  "all",
  "custom",
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export const BUCKETS = ["hour", "day", "week", "month"] as const;
export type Bucket = (typeof BUCKETS)[number];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** `all` lower bound; the caller clamps to the site row's createdAt. */
const ALL_FROM_ISO = "2020-01-01";

export interface ResolvedWindow {
  /** Epoch ms, half-open [from, to). */
  from: number;
  to: number;
  /** The equal-length window immediately before, for comparison deltas. */
  previous: { from: number; to: number };
  bucket: Bucket;
}

/** An invalid IANA name degrades to UTC rather than failing the query: the
 *  tz comes from the browser and is cosmetic (bucket cuts), not authz. */
export function safeTimeZone(tz: string): string {
  const probe = Result.try({
    try: () => Temporal.Now.zonedDateTimeISO(tz),
    catch: (cause) => cause,
  });
  return probe.isOk() ? tz : "UTC";
}

export function bucketFor(spanMs: number): Bucket {
  if (spanMs <= 2 * DAY_MS) return "hour";
  if (spanMs <= 92 * DAY_MS) return "day";
  if (spanMs <= 400 * DAY_MS) return "week";
  return "month";
}

function zonedNow(now: number, tz: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(tz);
}

/** Preset → window start (epoch ms). `to` is always `now` except yesterday. */
function presetBounds(
  range: Exclude<RangePreset, "custom">,
  tz: string,
  now: number,
): { from: number; to: number } {
  const today = zonedNow(now, tz).startOfDay();
  switch (range) {
    case "today":
      return { from: today.epochMilliseconds, to: now };
    case "yesterday":
      return { from: today.subtract({ days: 1 }).epochMilliseconds, to: today.epochMilliseconds };
    case "24h":
      return { from: now - DAY_MS, to: now };
    case "7d":
      return { from: today.subtract({ days: 6 }).epochMilliseconds, to: now };
    case "30d":
      return { from: today.subtract({ days: 29 }).epochMilliseconds, to: now };
    case "90d":
      return { from: today.subtract({ days: 89 }).epochMilliseconds, to: now };
    case "6mo":
      return { from: today.with({ day: 1 }).subtract({ months: 5 }).epochMilliseconds, to: now };
    case "12mo":
      return { from: today.with({ day: 1 }).subtract({ months: 11 }).epochMilliseconds, to: now };
    case "all":
      return {
        from: Temporal.PlainDate.from(ALL_FROM_ISO).toZonedDateTime(tz).epochMilliseconds,
        to: now,
      };
  }
}

export function resolveWindow(input: {
  range: RangePreset;
  from?: number;
  to?: number;
  tz: string;
  now: number;
}): ResolvedWindow {
  const tz = safeTimeZone(input.tz);
  const custom = input.range === "custom" && input.from !== undefined && input.to !== undefined;
  const bounds = custom
    ? // Validated at the contract (from < to, ≤ 400 days); a custom window may
      // end in the past. Non-null by the `custom` guard.
      { from: input.from ?? 0, to: input.to ?? 0 }
    : presetBounds(input.range === "custom" ? "7d" : input.range, tz, input.now);
  const span = bounds.to - bounds.from;
  return {
    from: bounds.from,
    to: bounds.to,
    previous: { from: bounds.from - span, to: bounds.from },
    bucket: bucketFor(span),
  };
}

function truncate(zdt: Temporal.ZonedDateTime, bucket: Bucket): Temporal.ZonedDateTime {
  switch (bucket) {
    case "hour":
      return zdt.round({ smallestUnit: "hour", roundingMode: "floor" });
    case "day":
      return zdt.startOfDay();
    case "week":
      // ISO week (Monday), matching Postgres date_trunc('week').
      return zdt.startOfDay().subtract({ days: zdt.dayOfWeek - 1 });
    case "month":
      return zdt.startOfDay().with({ day: 1 });
  }
}

const BUCKET_STEP: Record<Bucket, Temporal.DurationLike> = {
  hour: { hours: 1 },
  day: { days: 1 },
  week: { weeks: 1 },
  month: { months: 1 },
};

/** Defense in depth: a 400-day window of hour buckets would be ~9600; nothing
 *  legitimate exceeds this (the bucket rule keeps series ≤ ~100 points). */
const MAX_BUCKETS = 20_000;

/**
 * Epoch-ms starts of every bucket whose start lies in [trunc(from), min(to,
 * now)), for zero-filling a series. A bucket that has started but not ended
 * is included (it is the live "current" point); one starting in the future
 * never is.
 */
export function bucketStarts(
  from: number,
  to: number,
  bucket: Bucket,
  tz: string,
  now: number,
): number[] {
  const zone = safeTimeZone(tz);
  const end = Math.min(to, now);
  const starts: number[] = [];
  let cursor = truncate(
    Temporal.Instant.fromEpochMilliseconds(from).toZonedDateTimeISO(zone),
    bucket,
  );
  while (cursor.epochMilliseconds < end && starts.length < MAX_BUCKETS) {
    starts.push(cursor.epochMilliseconds);
    cursor = cursor.add(BUCKET_STEP[bucket]);
  }
  return starts;
}
