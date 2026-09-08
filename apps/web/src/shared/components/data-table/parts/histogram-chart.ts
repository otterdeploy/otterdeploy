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
  CLOCK_DAY,
  CLOCK_MINUTES,
  CLOCK_SECONDS,
  CLOCK_STAMP,
  clockFormatter,
} from "@/shared/lib/clock";

const dayTick = clockFormatter(CLOCK_DAY);
const minuteTick = clockFormatter(CLOCK_MINUTES);
const secondTick = clockFormatter(CLOCK_SECONDS);
const stamp = clockFormatter(CLOCK_STAMP);

/** Past about two days, clock times repeat down the axis and say nothing. */
const DAY_TICK_FROM_MS = 2 * 24 * 60 * 60 * 1000;
/** Under a quarter hour the ticks land between whole minutes. */
const SECOND_TICK_UNDER_MS = 15 * 60 * 1000;

/**
 * The tick format follows the SPAN, not the bucket.
 *
 * A week of buckets labelled "02:00, 02:00, 14:00, 14:00…" is the failure this
 * exists to prevent: every label was true and the axis still carried no
 * information, because the part that changed was the part not being printed.
 */
function tickFormatFor(spanMs: number): (value: number) => string {
  if (spanMs >= DAY_TICK_FROM_MS) return dayTick;
  if (spanMs <= SECOND_TICK_UNDER_MS) return secondTick;
  return minuteTick;
}

/** Where the tooltip may sit, in order of preference. */
const TOOLTIP_PLACEMENT = ["top", "right", "left", "bottom"] as const;
/** One hover reports every category in that bucket, which is why they stack. */
const GROUP_X = "group-x" as const;

/** A parked window: the accent, at the weight DESIGN.md allows for a wash. */
const SELECTION_STYLE = { fill: "var(--primary)", fillOpacity: 0.12 } as const;
const HANDLE_STYLE = { fill: "var(--primary)", fillOpacity: 0.9 } as const;
/** Present for the drag, invisible until there is something to show. */
const HIDDEN_STYLE = { fill: "transparent", fillOpacity: 0, strokeOpacity: 0 } as const;

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

  const first = starts[0] ?? 0;
  const last = starts.at(-1) ?? first;
  const formatTick = tickFormatFor(last - first);

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
            ticks: { spacing: 110, size: 0, format: formatTick },
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
            // With nothing parked the selection is the degenerate range at the
            // first bucket, which the brush still DRAWS — that is the solid
            // block that used to sit over the first bar on every load. It is
            // painted out rather than positioned away: the brush needs a range
            // to accept a drag, and an off-canvas one would break the drag.
            selectionStyle: parked ? SELECTION_STYLE : HIDDEN_STYLE,
            handleStyle: parked ? HANDLE_STYLE : HIDDEN_STYLE,
            range: controlledSignal<BrushRange<number>, BrushXChange<number>>(
              parked ?? { start: first, end: first },
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
    [segments, starts, categories, tones, defaultTone, parked, onPark, first, formatTick],
  );
}
