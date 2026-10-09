/**
 * Where a time axis puts its ticks, and what each tick says.
 *
 * Every time axis in the product reads through here: the time-series chart
 * (metrics, analytics) and the bucketed histogram above the log tables.
 *
 * The bug this exists to end: d3 picked tick positions on its own (UTC-aligned,
 * as many as the pixel spacing allowed) and a separate rule picked the label
 * format from the span. The two disagreed whenever the ticks were finer than
 * the label: a 7-day axis ticked every 12 hours under a day format read
 * `Oct 2 · Oct 2 · Oct 3 · Oct 3`, and a 16-minute histogram ticked every 30
 * seconds under a minute format read `04:33 · 04:33 · 04:34 · 04:34`. Here the
 * STEP is chosen first and the label follows from it, so a label can never be
 * coarser than the distance between two ticks.
 *
 * Ticks land on round wall-clock boundaries in the zone the labels print in
 * (midnights, whole hours, whole minutes), not on UTC boundaries: a UTC
 * midnight tick labelled in Berlin reads `02:00`, eleven times over.
 */

import { Temporal } from "@otterdeploy/shared/temporal";

import { VIEW_ZONE, zonedFormatter } from "@/shared/lib/clock";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Wall-clock steps under a day. Each divides a day evenly, so the ticks of
 *  one day line up with the next. */
const SUB_DAY_STEPS = [
  SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
] as const;

/** Calendar steps: days, then months, then years. Approximate widths are only
 *  used to pick a step; the ticks themselves are real calendar boundaries. */
const DAY_STEPS = [1, 2, 7] as const;
const MONTH_STEPS = [1, 3, 6] as const;
const YEAR_STEPS = [1, 2, 5, 10, 25, 50, 100] as const;
const MONTH_APPROX = 30 * DAY;
const YEAR_APPROX = 365 * DAY;

type Step =
  | { unit: "ms"; size: number }
  | { unit: "day"; size: number }
  | { unit: "month"; size: number }
  | { unit: "year"; size: number };

function approxMs(step: Step): number {
  switch (step.unit) {
    case "ms":
      return step.size;
    case "day":
      return step.size * DAY;
    case "month":
      return step.size * MONTH_APPROX;
    case "year":
      return step.size * YEAR_APPROX;
  }
}

const LADDER: readonly Step[] = [
  ...SUB_DAY_STEPS.map((size): Step => ({ unit: "ms", size })),
  ...DAY_STEPS.map((size): Step => ({ unit: "day", size })),
  ...MONTH_STEPS.map((size): Step => ({ unit: "month", size })),
  ...YEAR_STEPS.map((size): Step => ({ unit: "year", size })),
];

/** The finest step that keeps the tick count within `maxTicks` and is no
 *  finer than `minStepMs` (a histogram cannot tick between its buckets). */
function chooseStep(spanMs: number, maxTicks: number, minStepMs: number): Step {
  const budget = Math.max(1, maxTicks);
  for (const step of LADDER) {
    const size = approxMs(step);
    if (size < minStepMs) continue;
    if (spanMs / size <= budget) return step;
  }
  return LADDER[LADDER.length - 1];
}

function zoned(ms: number, zone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone);
}

/** The instant a wall-clock moment names in `zone`. A moment that falls in a
 *  DST gap resolves forward, the way a wall clock does. */
function epochOfWall(date: Temporal.PlainDate, offsetMs: number, zone: string): number {
  return date
    .toPlainDateTime()
    .add({ milliseconds: offsetMs })
    .toZonedDateTime(zone, { disambiguation: "compatible" }).epochMilliseconds;
}

/** Safety bound on any one generator. A chosen step yields at most about
 *  `maxTicks` ticks; this only stops a pathological input from spinning. */
const MAX_CANDIDATES = 2000;

function subDayTicks(startMs: number, endMs: number, stepMs: number, zone: string): number[] {
  const first = zoned(startMs, zone);
  const out: number[] = [];
  let date = first.toPlainDate();
  const intoDay =
    ((first.hour * 60 + first.minute) * 60 + first.second) * SECOND + first.millisecond;
  let offset = Math.floor(intoDay / stepMs) * stepMs;
  for (let guard = 0; guard < MAX_CANDIDATES; guard++) {
    if (offset >= DAY) {
      date = date.add({ days: 1 });
      offset = 0;
    }
    const at = epochOfWall(date, offset, zone);
    if (at > endMs) break;
    if (at >= startMs && (out.length === 0 || at > out[out.length - 1])) out.push(at);
    offset += stepMs;
  }
  return out;
}

function calendarTicks(startMs: number, endMs: number, step: Step, zone: string): number[] {
  const out: number[] = [];
  const first = zoned(startMs, zone).toPlainDate();
  let date =
    step.unit === "day"
      ? first
      : step.unit === "month"
        ? first.with({ day: 1 })
        : first.with({ month: 1, day: 1 });
  const keep = (d: Temporal.PlainDate): boolean => {
    if (step.unit === "day") {
      if (step.size === 7) return d.dayOfWeek === 1;
      return (d.day - 1) % step.size === 0;
    }
    if (step.unit === "month") return (d.month - 1) % step.size === 0;
    return d.year % step.size === 0;
  };
  for (let guard = 0; guard < MAX_CANDIDATES; guard++) {
    const at = epochOfWall(date, 0, zone);
    if (at > endMs) break;
    if (at >= startMs && keep(date)) out.push(at);
    date =
      step.unit === "day"
        ? date.add({ days: 1 })
        : step.unit === "month"
          ? date.add({ months: 1 })
          : date.add({ years: 1 });
  }
  return out;
}

const LABELS = {
  seconds: { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" },
  minutes: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  day: { month: "short", day: "numeric" },
  month: { month: "short" },
  year: { year: "numeric" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/** Formatters are built once per zone and reused: the axis formats every tick
 *  on every render, and building an `Intl.DateTimeFormat` is the slow part. */
const formatterCache = new Map<string, Record<keyof typeof LABELS, (ms: number) => string>>();

function formattersFor(zone: string) {
  const cached = formatterCache.get(zone);
  if (cached) return cached;
  const built = {
    seconds: zonedFormatter(LABELS.seconds, zone),
    minutes: zonedFormatter(LABELS.minutes, zone),
    day: zonedFormatter(LABELS.day, zone),
    month: zonedFormatter(LABELS.month, zone),
    year: zonedFormatter(LABELS.year, zone),
  };
  formatterCache.set(zone, built);
  return built;
}

export interface TimeTicks {
  /** Tick instants, epoch ms, ascending, all inside the window. */
  values: number[];
  /** The label for a tick. Granularity follows the step, so two ticks never
   *  share a label unless a coarser boundary label sits between them (an axis
   *  that crosses midnight reads `22:00 · Oct 8 · 02:00`). */
  label: (ms: number) => string;
}

export interface TimeTickOptions {
  /** Most ticks the axis has room for. */
  maxTicks: number;
  /** Never tick finer than this (a bucketed axis's bucket width). */
  minStepMs?: number;
  /** The zone the ticks align to and print in. Defaults to the viewer's. */
  zone?: string;
}

export function timeTicks(startMs: number, endMs: number, options: TimeTickOptions): TimeTicks {
  const zone = options.zone ?? VIEW_ZONE;
  const fmt = formattersFor(zone);
  if (!(endMs > startMs)) {
    return { values: Number.isFinite(startMs) ? [startMs] : [], label: fmt.minutes };
  }
  const step = chooseStep(endMs - startMs, options.maxTicks, options.minStepMs ?? 0);

  if (step.unit === "ms") {
    const values = subDayTicks(startMs, endMs, step.size, zone);
    if (step.size < MINUTE) return { values, label: fmt.seconds };
    // A tick on midnight names the day instead of reading `00:00`: the one
    // place the date changes is the one place the axis says so.
    const label = (ms: number) => {
      const at = zoned(ms, zone);
      return at.hour === 0 && at.minute === 0 ? fmt.day(ms) : fmt.minutes(ms);
    };
    return { values, label };
  }

  const values = calendarTicks(startMs, endMs, step, zone);
  if (step.unit === "day") return { values, label: fmt.day };
  if (step.unit === "month") {
    // January names its year; the other months name themselves.
    const label = (ms: number) => (zoned(ms, zone).month === 1 ? fmt.year(ms) : fmt.month(ms));
    return { values, label };
  }
  return { values, label: fmt.year };
}

/** How many ticks fit across `widthPx` at one per `spacingPx`. */
export function tickBudget(widthPx: number, spacingPx: number): number {
  return Math.max(2, Math.floor(widthPx / spacingPx));
}

/**
 * Ticks for a bucketed axis (a band scale over bucket starts).
 *
 * A band scale can only tick its own members, so each wall-clock tick is
 * pinned to the bucket that contains it and labelled with the tick's own
 * time: a 30-second bucket starting 04:34:30 carries the `04:35` label it
 * contains, rather than a second `04:34`.
 */
export function bucketTicks(
  starts: readonly number[],
  bucketMs: number,
  options: { maxTicks: number; zone?: string },
): TimeTicks {
  const first = starts[0];
  const last = starts[starts.length - 1];
  if (first === undefined || last === undefined) {
    return { values: [], label: formattersFor(options.zone ?? VIEW_ZONE).minutes };
  }
  const ticks = timeTicks(first, last + Math.max(0, bucketMs - 1), {
    maxTicks: options.maxTicks,
    minStepMs: bucketMs,
    zone: options.zone,
  });
  const labelByStart = new Map<number, string>();
  let index = 0;
  for (const at of ticks.values) {
    while (index + 1 < starts.length && starts[index + 1] <= at) index++;
    const start = starts[index];
    if (at >= start && at < start + Math.max(1, bucketMs) && !labelByStart.has(start)) {
      labelByStart.set(start, ticks.label(at));
    }
  }
  return {
    values: [...labelByStart.keys()],
    label: (start) => labelByStart.get(start) ?? ticks.label(start),
  };
}
