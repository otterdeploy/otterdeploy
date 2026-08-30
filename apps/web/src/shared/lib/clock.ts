/**
 * Wall-clock formatting through Temporal.
 *
 * Time in the app is an epoch-millisecond number or a Temporal value. `Date`
 * survives only where a library insists on it: d3's time scale hands the axis
 * `Date` ticks, and the oRPC wire format revives `z.date()` fields as `Date`.
 * Both cross into Temporal here, through `instantOf`, and nothing downstream
 * touches a `Date` method again.
 *
 * Formatters are built once and reused: the chart axis formats every tick on
 * every render, and constructing an `Intl.DateTimeFormat` per call is the
 * slow part of formatting a time.
 */

import { Intl as TemporalIntl, Temporal, toTemporalInstant } from "@otterdeploy/shared/temporal";

/** A moment from either side of a library seam. */
export type Moment = number | Date | Temporal.Instant;

export function instantOf(value: Moment): Temporal.Instant {
  if (value instanceof Temporal.Instant) return value;
  if (typeof value === "number") return Temporal.Instant.fromEpochMilliseconds(value);
  return toTemporalInstant.call(value);
}

export function epochMsOf(value: Moment): number {
  return instantOf(value).epochMilliseconds;
}

export type ClockFormat = (value: Moment) => string;

/** A locale formatter in the viewer's time zone, reusable across calls. */
export function clockFormatter(options: Intl.DateTimeFormatOptions): ClockFormat {
  const format = new TemporalIntl.DateTimeFormat(undefined, options);
  return (value) => format.format(instantOf(value));
}

/** 24-hour clock whatever the locale: a clock beside a chart axis is a scale
 *  reading, and a scale should not carry "PM" eleven times over. */
export const CLOCK_MINUTES = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
} as const satisfies Intl.DateTimeFormatOptions;

export const CLOCK_SECONDS = {
  ...CLOCK_MINUTES,
  second: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

export const CLOCK_DAY = {
  month: "short",
  day: "numeric",
} as const satisfies Intl.DateTimeFormatOptions;

export const CLOCK_STAMP = {
  ...CLOCK_DAY,
  ...CLOCK_MINUTES,
} as const satisfies Intl.DateTimeFormatOptions;

/** Full date + time. For a hover that has to stay unambiguous months later,
 *  where `CLOCK_STAMP`'s month/day alone would not say which year. */
export const CLOCK_EXACT = {
  year: "numeric",
  ...CLOCK_DAY,
  ...CLOCK_MINUTES,
} as const satisfies Intl.DateTimeFormatOptions;

/**
 * An ISO-8601 string off the wire as epoch milliseconds, or null when it isn't
 * a time at all.
 *
 * `Date.parse` rather than `Temporal.Instant.from`: the wire carries whatever
 * the server sent, and a malformed value has to become a null the caller can
 * render a dash for, not a throw inside a table row. It yields a NUMBER, which
 * is the app's own time type, so no `Date` object is created here.
 */
export function epochMsFromIso(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
