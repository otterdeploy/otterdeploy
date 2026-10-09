/**
 * The time axis of every chart: which span it covers, the d3 scale that draws
 * it, and the ticks along it. Its own module so the chart file stays about
 * marks.
 */
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleUtc } from "d3-scale";

import { epochMsOf } from "@/shared/lib/clock";

import type { TimeRow } from "./series-rows";

import { tickBudget, timeTicks } from "./time-ticks";
import { countTicks } from "./value-ticks";

/** A time window in epoch milliseconds. */
export interface TimeWindow {
  startMs: number;
  endMs: number;
}

/** Pixels per x tick label: a 24-hour clock plus breathing room. */
const X_TICK_SPACING_PX = 90;

/**
 * The span the axis covers. A pinned window is taken as given, never niced:
 * niceness would widen "the last 30 minutes" to whatever round interval d3
 * prefers, which is the bug the window exists to fix. Without a window the
 * axis spans the data exactly, first sample to last.
 */
export function axisDomain(
  rows: readonly TimeRow[],
  pinned: TimeWindow | undefined,
): TimeWindow | null {
  if (pinned && pinned.endMs > pinned.startMs) return pinned;
  if (rows.length < 2) return null;
  const startMs = rows[0].ts;
  const endMs = rows[rows.length - 1].ts;
  return endMs > startMs ? { startMs, endMs } : null;
}

/**
 * The x axis for a chart `widthPx` wide.
 *
 * With a domain, the ticks are ours (see `time-ticks.ts`): aligned to the
 * viewer's wall clock and labelled at the granularity of their own step, so a
 * label never repeats along the axis. Without one (a single sample, nothing to
 * span) the scale fits the data and d3 places the lone tick.
 */
export function timeXAxis(
  rows: readonly TimeRow[],
  pinned: TimeWindow | undefined,
  widthPx: number,
  /** The series' sampling interval: a daily series is not ticked at noon,
   *  where it has no value to read. */
  minStepMs = 0,
) {
  const domain = axisDomain(rows, pinned);
  if (domain === null) {
    const ticks = timeTicks(rows[0]?.ts ?? 0, rows[0]?.ts ?? 0, { maxTicks: 1 });
    return {
      scale: scaleUtc,
      nice: true,
      ticks: { values: undefined, label: ticks.label },
    };
  }
  const ticks = timeTicks(domain.startMs, domain.endMs, {
    maxTicks: tickBudget(widthPx, X_TICK_SPACING_PX),
    minStepMs,
  });
  return {
    // d3's time scale only speaks Date: this is the library seam.
    scale: scaleUtc().domain([new Date(domain.startMs), new Date(domain.endMs)]),
    nice: false,
    ticks: { values: ticks.values.map((ms) => new Date(ms)), label: ticks.label },
  };
}

/** A d3 tick (a `Date`) as the label its step earned. */
function tickLabel(label: (ms: number) => string) {
  return (value: Date) => label(epochMsOf(value));
}

export interface AxisInput {
  data: readonly TimeRow[];
  timeWindow: TimeWindow | undefined;
  widthPx: number;
  format: (value: number) => string;
  max: number | "auto";
  compact: boolean;
  /** Whole-number ticks up to this peak; undefined lets the scale decide. */
  countPeak: number | undefined;
  /** Expected ms between samples: the finest step the x axis ticks at. */
  sampleIntervalMs: number;
}

/**
 * No axis lines: the dashed grid already frames the plot, and a solid baseline
 * under a zero-hugging series hides the series. The x axis keeps its tick
 * stubs so a label reads as "at this instant", not "around here".
 */
export function chartAxes({
  data,
  timeWindow,
  widthPx,
  format,
  max,
  compact,
  countPeak,
  sampleIntervalMs,
}: AxisInput) {
  const time = timeXAxis(data, timeWindow, widthPx, sampleIntervalMs);
  const x = {
    scale: time.scale,
    nice: time.nice,
    axis: compact
      ? false
      : {
          line: false,
          // Exactly one candidate policy: the chart rejects `values` beside
          // `spacing` or `count`, so the fallback spacing applies only when
          // there are no ticks of our own.
          ticks: {
            ...(time.ticks.values ? { values: time.ticks.values } : { spacing: X_TICK_SPACING_PX }),
            size: 4,
            // d3's time scale hands us Date ticks; the label crosses them into
            // Temporal before formatting.
            format: tickLabel(time.ticks.label),
          },
        },
  } as const;
  const counts = countPeak === undefined ? null : countTicks(max === "auto" ? countPeak : max);
  const y = {
    scale: scaleLinear,
    nice: counts === null,
    grid: !compact,
    domain: counts ? [0, counts.top] : max === "auto" ? undefined : [0, max],
    axis: compact
      ? false
      : {
          line: false,
          ticks: {
            ...(counts ? { values: counts.values } : { count: 4 }),
            size: 0,
            format: (value: number) => format(value),
          },
        },
  } as const;
  return { x, y };
}
