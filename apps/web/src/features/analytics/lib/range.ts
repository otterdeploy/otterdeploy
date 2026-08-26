/**
 * The web-analytics range vocabulary and its bridges: preset keys ↔ i18n
 * labels, day-boundary math in the viewer's timezone (Temporal, never Date
 * arithmetic), and the mapping onto the edge plane's narrower four-preset
 * window so the Traffic tab keeps working under the richer URL.
 */

import { Temporal } from "@otterdeploy/shared/temporal";

export const RANGE_KEYS = [
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

export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABEL_KEYS = {
  today: "analytics.range.today",
  yesterday: "analytics.range.yesterday",
  "24h": "analytics.range.h24",
  "7d": "analytics.range.d7",
  "30d": "analytics.range.d30",
  "90d": "analytics.range.d90",
  "6mo": "analytics.range.mo6",
  "12mo": "analytics.range.mo12",
  all: "analytics.range.all",
  custom: "analytics.range.custom",
} as const satisfies Record<RangeKey, string>;

// ─── Day boundaries in a timezone ──────────────────────────────────────────

function startOfDay(instant: Temporal.Instant, tz: string): Temporal.ZonedDateTime {
  return instant.toZonedDateTimeISO(tz).startOfDay();
}

/** Midnight opening the day containing `epochMs`, in `tz`. */
export function dayStartMs(epochMs: number, tz: string): number {
  return startOfDay(Temporal.Instant.fromEpochMilliseconds(epochMs), tz).epochMilliseconds;
}

/** End of that day, clamped so a range ending today never reaches into the
 *  future — a window that includes time nobody has lived is a lie. */
export function dayEndMs(epochMs: number, tz: string, nowMs: number): number {
  const nextMidnight = startOfDay(Temporal.Instant.fromEpochMilliseconds(epochMs), tz).add({
    days: 1,
  }).epochMilliseconds;
  return Math.min(nextMidnight - 1, nowMs);
}

// ─── Bridge to the edge plane's window ─────────────────────────────────────

const EDGE_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type EdgeRangeKey = (typeof EDGE_RANGES)[number];

export interface EdgeWindow {
  range: EdgeRangeKey | "custom";
  from?: number;
  to?: number;
}

/**
 * New range values → the Traffic tab's four presets + custom. Day presets
 * become explicit custom windows (same days, honest boundaries); the long
 * presets clamp to 90d — the widest window the edge rollups serve — rather
 * than pretending at a year the plane cannot answer.
 */
export function toEdgeWindow(
  range: RangeKey,
  from: number | undefined,
  to: number | undefined,
  tz: string,
  nowMs: number,
): EdgeWindow {
  switch (range) {
    case "today":
      return { range: "custom", from: dayStartMs(nowMs, tz), to: nowMs };
    case "yesterday": {
      const todayStart = dayStartMs(nowMs, tz);
      return { range: "custom", from: dayStartMs(todayStart - 1, tz), to: todayStart - 1 };
    }
    case "custom":
      return from !== undefined && to !== undefined
        ? { range: "custom", from, to }
        : { range: "24h" };
    case "6mo":
    case "12mo":
    case "all":
      return { range: "90d" };
    default:
      return { range };
  }
}
