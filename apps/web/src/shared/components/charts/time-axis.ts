/**
 * The time axis of every chart: which span it covers and the d3 scale that
 * draws it. Its own module so the chart file stays about marks.
 */
import { scaleUtc } from "d3-scale";

import {
  CLOCK_DAY,
  CLOCK_MINUTES,
  CLOCK_SECONDS,
  clockFormatter,
  type ClockFormat,
} from "@/shared/lib/clock";

import type { TimeRow } from "./series-rows";

const timeTick = clockFormatter(CLOCK_MINUTES);
const secondTick = clockFormatter(CLOCK_SECONDS);
const dayTick = clockFormatter(CLOCK_DAY);

/** A window wider than about two days reads better as dates than as clock
 *  times; an axis of "02:00" repeated eleven times is noise, not a scale. */
const DAY_TICK_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;
/** Under this span the ticks land between whole minutes, so a label without
 *  seconds would repeat itself along the axis. */
const SECOND_TICK_THRESHOLD_MS = 15 * 60 * 1000;

/** Clock labels for the span in view: dates past two days, seconds under
 *  fifteen minutes, minutes between. */
export function axisTickFormat(spanMs: number): ClockFormat {
  if (spanMs >= DAY_TICK_THRESHOLD_MS) return dayTick;
  if (spanMs <= SECOND_TICK_THRESHOLD_MS) return secondTick;
  return timeTick;
}

/** A time window in epoch milliseconds. */
export interface TimeWindow {
  startMs: number;
  endMs: number;
}

/**
 * The span the axis covers and the x scale that draws it. A pinned window is
 * taken as given, never niced: niceness would widen "the last 30 minutes" to
 * whatever round interval d3 prefers, which is the bug the window exists to
 * fix. Without a window the axis fits the data, as before.
 *
 */
export function timeAxisScale(rows: readonly TimeRow[], pinned: TimeWindow | undefined) {
  if (pinned && pinned.endMs > pinned.startMs) {
    return {
      spanMs: pinned.endMs - pinned.startMs,
      // d3's time scale only speaks Date: this is the library seam.
      scale: scaleUtc().domain([new Date(pinned.startMs), new Date(pinned.endMs)]),
      nice: false,
    };
  }
  const spanMs = rows.length > 1 ? rows[rows.length - 1].ts - rows[0].ts : 0;
  return { spanMs, scale: scaleUtc, nice: true };
}
