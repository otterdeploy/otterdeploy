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
import { CLOCK_MINUTES, CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";

const tick = clockFormatter(CLOCK_MINUTES);
const stamp = clockFormatter(CLOCK_STAMP);

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
}

export function useHistogramDefinition(params: HistogramChartParams) {
  const { segments, starts, categories, tones, defaultTone, parked, onPark } = params;
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
    [segments, starts, categories, tones, defaultTone, parked, onPark],
  );
}
