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

/**
 * The zone every clock in the app reads in: the viewer's own.
 *
 * One install used to show three clocks: the edge tables printed UTC, the
 * project logs and metrics printed local time, and Analytics named the
 * browser's zone in its footer. An operator lining up a 502 on the Edge page
 * against a log line and a CPU spike read three different numbers for one
 * instant. Every surface now reads in this zone, and the two things the old
 * UTC tables were protecting are kept another way:
 *
 * - The unambiguous instant is one hover away: every clock cell carries the
 *   UTC ISO stamp in its title (see {@link utcIso}), so two people comparing
 *   a row still have a shared string to paste.
 * - The zone is never silent: a time column names it once, in its header
 *   (see {@link zoneAbbreviation}), rather than on a thousand cells.
 *
 * Feeds that bucket or day-bound on the server pass this zone too, so a
 * histogram bar and the rows under it agree about which day they are in.
 */
export const VIEW_ZONE: string = Temporal.Now.timeZoneId();

/** A formatter pinned to `timeZone`, for code that must not depend on the
 *  runtime default (tests, and anything computed for a zone other than the
 *  viewer's). */
export function zonedFormatter(options: Intl.DateTimeFormatOptions, timeZone: string): ClockFormat {
  const format = new TemporalIntl.DateTimeFormat(undefined, { ...options, timeZone });
  return (value) => format.format(instantOf(value));
}

/** The instant as an ISO-8601 UTC stamp, to the millisecond. The string to
 *  paste into an incident channel: it reads the same in every zone. */
export function utcIso(value: Moment): string {
  return instantOf(value).toString({ smallestUnit: "millisecond" });
}

/**
 * The short name of a zone at an instant: "CEST", "GMT+2", "UTC".
 *
 * At an instant because the name moves: Berlin is CET in winter and CEST in
 * summer, and a header that said "CET" over summer rows would be a lie.
 */
export function zoneAbbreviation(
  timeZone: string = VIEW_ZONE,
  at: Moment = Temporal.Now.instant(),
): string {
  const parts = new TemporalIntl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(instantOf(at));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
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

/** A log row's clock: to the millisecond, because log lines arrive within the
 *  same second and their order is the information. */
export const LOG_CLOCK = {
  ...CLOCK_SECONDS,
  fractionalSecondDigits: 3,
} as const satisfies Intl.DateTimeFormatOptions;

export const CLOCK_DAY = {
  month: "short",
  day: "numeric",
} as const satisfies Intl.DateTimeFormatOptions;

export const CLOCK_STAMP = {
  ...CLOCK_DAY,
  ...CLOCK_MINUTES,
} as const satisfies Intl.DateTimeFormatOptions;

/** A calendar date with its year, no clock. For an axis whose ticks are months
 *  apart, where the time of day is noise and the year is the missing fact. */
export const CLOCK_DATE = {
  year: "numeric",
  ...CLOCK_DAY,
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
