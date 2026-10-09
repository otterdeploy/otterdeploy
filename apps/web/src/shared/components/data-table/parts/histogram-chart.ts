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

import { bucketTicks, tickBudget } from "@/shared/components/charts/time-ticks";
import {
  rankedByCount,
  type Segment,
} from "@/shared/components/data-table/parts/histogram-tooltip";
import { CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";

const stamp = clockFormatter(CLOCK_STAMP);

/** Pixels per label: a bucketed axis with forty stamps on it is a texture,
 *  not a scale. */
const TICK_SPACING_PX = 110;

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
  return useMemo(
    () =>
      defineChart(
        // Responsive: how many labels fit is a question about width, and the
        // ticks are chosen from it (see `bucketTicks`) rather than thinned
        // after the fact into repeats.
        ({ width }) => {
          const ticks = bucketTicks(starts, bucketMs, {
            maxTicks: tickBudget(width, TICK_SPACING_PX),
          });
          return {
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
                ticks: { values: ticks.values, size: 0, format: ticks.label },
              },
            },
            y: { scale: scaleLinear, nice: true, axis: false, grid: false },
            clip: true,
            color: {
              scale: scaleOrdinal<string, string>,
              domain: categories,
              range: categories.map((category) => tones?.[category] ?? defaultTone),
            },
          };
        },
        {
          focus: GROUP_X,
          maxFocusDistance: Number.POSITIVE_INFINITY,
          keyboard: true,
          tooltip: { use: tooltip, placement: TOOLTIP_PLACEMENT, sort: rankedByCount },
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
        },
      ),
    [segments, starts, categories, tones, defaultTone, parked, onPark, bucketMs],
  );
}
