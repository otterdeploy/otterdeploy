/**
 * The histogram's chart definition.
 *
 * Split from the component because the definition IS the chart — the marks,
 * the scales, the interaction and the brush are one object, and reading them
 * next to the component's loading and empty branches made both harder to see.
 *
 * The brush is a controlled signal that only PARKS its result: applying a
 * window on every drag would re-query the table under the reader for a stray
 * gesture across a chart that sits directly above the rows they are reading.
 */

import { useMemo } from "react";

import { barY, defineChart } from "@tanstack/charts";
import { brushX, type BrushRange, type BrushXChange } from "@tanstack/charts/interaction/brush";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";

import {
  rankedByCount,
  type Segment,
} from "@/shared/components/data-table/parts/histogram-tooltip";
import {
  CLOCK_DATE,
  CLOCK_DAY,
  CLOCK_MINUTES,
  CLOCK_STAMP,
  utcFormatter,
} from "@/shared/lib/clock";

const stamp = utcFormatter(CLOCK_STAMP);

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** One rung per readable granularity, built once — the axis formats every tick
 *  on every render. */
const TICK_FORMATS = {
  clock: utcFormatter(CLOCK_MINUTES),
  dayClock: utcFormatter(CLOCK_STAMP),
  day: utcFormatter(CLOCK_DAY),
  date: utcFormatter(CLOCK_DATE),
} as const;

/**
 * The tick format the axis's own span earns.
 *
 * A fixed `HH:mm` was the bug: an audit log bucketed by DAY put a tick on every
 * midnight, so a five-week axis read `02:00 02:00 02:00 02:00 02:00` — five
 * identical labels under bars that were weeks apart, which is not a scale.
 * The rungs are chosen so that adjacent ticks can actually differ: dates once
 * the window is longer than a day and a half, the year once it outlives one.
 */
function tickFormatFor(spanMs: number): (value: number) => string {
  if (spanMs <= 36 * HOUR_MS) return TICK_FORMATS.clock;
  if (spanMs <= 10 * DAY_MS) return TICK_FORMATS.dayClock;
  if (spanMs <= 365 * DAY_MS) return TICK_FORMATS.day;
  return TICK_FORMATS.date;
}

/** Where the tooltip may sit, in order of preference. */
const TOOLTIP_PLACEMENT = ["top", "right", "left", "bottom"] as const;
/** One hover reports every category in that bucket, which is why they stack. */
const GROUP_X = "group-x" as const;

export interface HistogramChartParams {
  segments: readonly Segment[];
  /** Bucket starts, in order — the band scale's domain and the brush's stops. */
  starts: readonly number[];
  categories: readonly string[];
  tones: Record<string, string> | undefined;
  defaultTone: string;
  parked: BrushRange<number> | null;
  onPark: (range: BrushRange<number>) => void;
  /** Width of one bucket, so the axis knows what the last tick covers. */
  bucketMs: number;
}

export function useHistogramDefinition(params: HistogramChartParams) {
  const { segments, starts, categories, tones, defaultTone, parked, onPark, bucketMs } = params;
  const first = starts[0];
  const last = starts[starts.length - 1];
  const spanMs = first === undefined || last === undefined ? bucketMs : last - first + bucketMs;
  const tick = tickFormatFor(spanMs);
  return useMemo(
    () =>
      defineChart({
        marks: [
          barY([...segments], {
            id: "buckets",
            x: "at",
            y: "count",
            z: "category",
            color: "category",
            inset: 0.5,
            radius: 1,
          }),
        ],
        x: {
          scale: () =>
            scaleBand<number>()
              .domain([...starts])
              .padding(0.12),
          axis: {
            line: false,
            // Only a handful of labels: a bucketed axis with forty stamps on it
            // is a texture, not a scale.
            ticks: { spacing: 110, size: 0, format: (value: number) => tick(value) },
          },
        },
        y: { scale: scaleLinear, nice: true, axis: false, grid: false },
        clip: true,
        focus: GROUP_X,
        maxFocusDistance: Number.POSITIVE_INFINITY,
        keyboard: true,
        tooltip: { use: tooltip, placement: TOOLTIP_PLACEMENT, sort: rankedByCount },
        color: {
          scale: scaleOrdinal<string, string>,
          domain: categories,
          range: categories.map((category) => tones?.[category] ?? defaultTone),
        },
        controls: [
          brushX({
            range: controlledSignal<BrushRange<number>, BrushXChange<number>>(
              parked ?? { start: starts[0] ?? 0, end: starts[0] ?? 0 },
              (next, { reason }) => {
                // Park on commit. Applying here would re-query on every stray
                // drag across a chart that sits above the rows being read.
                if (reason.type === "commit") onPark(next);
              },
            ),
            values: [...starts],
            format: (value: number) => stamp(value),
            ariaLabel: "Time window",
            startAriaLabel: "Window start",
            endAriaLabel: "Window end",
          }),
        ],
      }),
    [segments, starts, categories, tones, defaultTone, parked, onPark, tick],
  );
}
