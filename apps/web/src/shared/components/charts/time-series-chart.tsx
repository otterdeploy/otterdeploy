/**
 * The one time-series chart in the product.
 *
 * Every metric surface draws through this — resource metrics, project
 * aggregates, host telemetry, edge analytics. One wrapper means one tooltip
 * idiom, one colour path, one theme integration and one set of honesty rules,
 * instead of each surface re-deciding what a gap in the data looks like.
 *
 * Built on the chart grammar rather than a chart-type component: marks compose,
 * so "stacked areas with a line on top and a threshold rule" is a list of marks
 * rather than a prop matrix that grows a branch per combination.
 *
 * What it owns, and why each is here rather than at the call site:
 *
 * - **Colour.** One series takes the grey ramp; several take slots on the
 *   categorical wheel, ranked by magnitude so the biggest contributor holds a
 *   stable slot. See shared/lib/chart-series.ts.
 * - **Gaps.** Samples further apart than the sampler could have produced draw
 *   as a break. A line across an outage is a measurement nobody took.
 * - **Ranked tooltips.** Grouped focus, rows sorted by value descending, and a
 *   total when the chart stacks — so a hover answers "what is eating this box"
 *   in the order the reader needs.
 * - **Filtering that dims.** Non-matching series lose alpha but keep their
 *   geometry. Removing them would move the axis domain and the stack height,
 *   so the shape being read shifts while it is being read.
 * - **Deferred first paint.** A chart below the fold builds nothing until it
 *   reaches the viewport.
 */

import type { ChartLinearGradient, ChartPoint } from "@tanstack/charts";

import { useMemo } from "react";

import { colorLegend, defineChart, areaY, lineY } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react/tooltip";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { curveMonotoneX } from "d3-shape";

import { dimmedSeriesColor, rankSeries, seriesColor } from "@/shared/lib/chart-series";
import { cn } from "@/shared/lib/utils";

import type { LongRow, TimeRow } from "./series-rows";

export type { TimeWindow } from "./time-axis";

import { applyFilter, peakValue, seriesTotals, toLongRows } from "./series-rows";
import { chartAxes, type TimeWindow } from "./time-axis";
import { TooltipBody } from "./tooltip-body";
import { useVisible } from "./use-visible";

interface ChartSeries<Row> {
  /** Field on the row to plot. */
  dataKey: Extract<keyof Row, string>;
  /** Legend, tooltip and filter label. */
  label: string;
  /** Explicit paint. Omit to take a slot on the categorical wheel. */
  color?: string;
}

interface TimeSeriesChartProps<Row extends TimeRow> {
  data: readonly Row[];
  series: readonly ChartSeries<Row>[];
  /** Formats axis ticks and tooltip values (percent, bytes, rate…). */
  format: (value: number) => string;
  ariaLabel: string;
  /** Stack the series and total them in the tooltip. Part-to-whole only —
   *  stacking series that are not parts of one total is a lie about the sum. */
  stacked?: boolean;
  /** "area" fills under the line. "line" draws the stroke alone — right for
   *  series that share an axis but not a baseline, like latency percentiles,
   *  where overlapping fills read as a quantity rather than three readings. */
  kind?: "area" | "line";
  /** Whitespace-separated terms. Matching series stay lit; the rest dim. */
  filter?: string;
  /** Upper Y bound. "auto" fits the data. */
  max?: number | "auto";
  /** The series are counts (visitors, requests): the y axis ticks on whole
   *  numbers. Without it a quiet window draws `0.2 · 0.4 · 0.6` people. */
  integer?: boolean;
  /** Expected ms between samples. Drives gap detection; 0 disables it. */
  sampleIntervalMs?: number;
  /** Pin the time axis to this window (epoch ms, start then end). Without it
   *  the axis fits the data, which is wrong whenever the data does not fill
   *  the window the reader picked: one sample on a "last 30 minutes" chart
   *  fitted d3's nice() day and drew a 24-hour axis around a dot. */
  timeWindow?: TimeWindow;
  /** Sparkline: no axes, no grid, no tooltip, no legend. */
  compact?: boolean;
  /** Legend under the plot. Defaults on above one series, off at one. */
  legend?: boolean;
  /** Monotone interpolation between samples. Right for a continuously
   *  varying quantity read at intervals (CPU, memory, throughput), where the
   *  true signal between two ticks is smooth. Wrong for bucketed counts, where
   *  a curve invents values a bucket never held; those keep straight segments. */
  smooth?: boolean;
  height?: number;
  className?: string;
}

/** Hoisted so their literal types survive into the definition. */
const GROUP_X = "group-x" as const;
const TOOLTIP_PLACEMENT = ["top", "right", "left", "bottom"] as const;

const MONOTONE = d3Curve(curveMonotoneX);

/** Fill under an overlaid line: strongest at the line, fading toward the
 *  baseline. Reads as "the area under this curve" without a solid block
 *  competing with the line that carries the reading. */
const FILL_TOP_OPACITY = 0.32;
const FILL_BOTTOM_OPACITY = 0.02;

const gradientId = (index: number) => `series-fill-${index}`;

/** One vertical gradient per series in its own paint, so the fill fades from
 *  the line down to the baseline. Ids are scoped per chart instance by the
 *  renderer, so two charts on a page never share a definition. */
function buildGradients(
  ordered: readonly string[],
  paint: (label: string) => string,
): ChartLinearGradient[] {
  return ordered.map((label, index) => {
    const paintColor = paint(label);
    return {
      id: gradientId(index),
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 1,
      stops: [
        { offset: 0, color: paintColor, opacity: FILL_TOP_OPACITY },
        { offset: 1, color: paintColor, opacity: FILL_BOTTOM_OPACITY },
      ],
    };
  });
}

/** Descending by value, nulls last. The ordering is the information. */
function rankedByValue(
  a: ChartPoint<LongRow, Date, number>,
  b: ChartPoint<LongRow, Date, number>,
): number {
  return (b.yValue ?? Number.NEGATIVE_INFINITY) - (a.yValue ?? Number.NEGATIVE_INFINITY);
}

export function TimeSeriesChart<Row extends TimeRow>({
  data,
  series,
  format,
  ariaLabel,
  stacked = false,
  kind = "area",
  filter = "",
  max = "auto",
  integer = false,
  sampleIntervalMs = 0,
  timeWindow,
  compact = false,
  legend,
  smooth = false,
  height = 160,
  className,
}: TimeSeriesChartProps<Row>) {
  const { ref, seen } = useVisible<HTMLDivElement>();

  const definition = useMemo(() => {
    const keys = series.map((s) => ({ dataKey: s.dataKey, label: s.label }));
    const long: LongRow[] = toLongRows(data, keys, sampleIntervalMs);

    // Slot assignment is ranked by magnitude so the dominant series keeps its
    // colour as the others shuffle beneath it.
    const labels = series.map((s) => s.label);
    const ranked = series.length > 1 ? rankSeries(seriesTotals(long)) : labels;
    // A series present in `series` but absent from the data still needs a slot,
    // or its legend entry has no colour.
    const ordered = [...ranked, ...labels.filter((l) => !ranked.includes(l))];
    const lit = applyFilter(labels, filter);

    const explicit = new Map(series.map((s) => [s.label, s.color]));
    const paint = (label: string): string => {
      const own = explicit.get(label);
      const index = ordered.indexOf(label);
      if (own !== undefined)
        return lit.has(label) ? own : `color-mix(in oklab, ${own} 12%, transparent)`;
      // One series is not a category: it takes the ramp, not a hue.
      if (series.length === 1) return "var(--chart-3)";
      return lit.has(label)
        ? seriesColor(index, ordered.length)
        : dimmedSeriesColor(index, ordered.length);
    };

    const color = {
      scale: scaleOrdinal<string, string>,
      domain: ordered,
      range: ordered.map(paint),
      legend:
        (legend ?? series.length > 1) && !compact
          ? colorLegend({ placement: "bottom" })
          : undefined,
    };

    // Whole-number ticks need the peak the plot will draw, so a count axis
    // tops out at a reachable number rather than a fraction above it.
    const countPeak = integer ? peakValue(long, stacked) : undefined;
    // Responsive: the x ticks depend on how many labels fit, which only the
    // rendered width can say. Everything else is built once per data change.
    const axesFor = (widthPx: number) =>
      chartAxes({ data, timeWindow, widthPx, format, max, compact, countPeak, sampleIntervalMs });

    // One uniform shape whatever the mode. Branching the *shape* rather than
    // the values gives `defineChart` a union to infer through, and it declines.
    const interaction = {
      // Grouped focus: one hover reports every series at that instant, which is
      // the whole point of drawing them together.
      focus: compact ? false : GROUP_X,
      maxFocusDistance: Number.POSITIVE_INFINITY,
      keyboard: !compact,
      tooltip: compact
        ? false
        : {
            use: tooltip,
            placement: TOOLTIP_PLACEMENT,
            // Largest first: the tooltip is a ranked answer, not a list in
            // whatever order the marks happen to sit.
            sort: rankedByValue,
          },
    } as const;

    const curve = smooth ? MONOTONE : undefined;

    if (stacked) {
      // Implicit stacking: repeated x positions stack by series when no
      // explicit y1/y2 is given. A stacked segment reports its own value in the
      // tooltip, not the cumulative endpoint.
      const marks = [
        areaY(long, { id: "series", x: "t", y: "value", z: "series", fillOpacity: 0.55, curve }),
      ] as const;
      return defineChart(
        ({ width }) => ({ marks, ...axesFor(width), color, clip: true }),
        interaction,
      );
    }

    const line = lineY(long, {
      id: "series-line",
      x: "t",
      y: "value",
      z: "series",
      strokeWidth: 1.75,
      curve,
    });

    if (kind === "line") {
      const marks = [line] as const;
      return defineChart(
        ({ width }) => ({ marks, ...axesFor(width), color, clip: true }),
        interaction,
      );
    }

    // Overlaid: explicit y1/y2 endpoints opt out of the implicit stack, so the
    // fill is decoration under a line that owns interaction.
    const marks = [
      decorative(
        areaY(long, {
          id: "series-fill",
          x: "t",
          y1: 0,
          y2: "value",
          z: "series",
          fill: (row: LongRow) => `url(#${gradientId(ordered.indexOf(row.series))})`,
          fillOpacity: 1,
          curve,
        }),
      ),
      line,
    ] as const;
    const gradients = buildGradients(ordered, paint);
    return defineChart(
      ({ width }) => ({ marks, gradients, ...axesFor(width), color, clip: true }),
      interaction,
    );
  }, [
    data,
    series,
    format,
    stacked,
    kind,
    filter,
    max,
    integer,
    sampleIntervalMs,
    timeWindow,
    compact,
    legend,
    smooth,
  ]);

  // Reserve the height before the chart exists so scrolling past an unread
  // chart does not shift everything below it.
  if (!seen) {
    return <div ref={ref} className={cn("w-full", className)} style={{ height }} />;
  }

  return (
    <div ref={ref} className={cn("w-full", className)}>
      <Chart
        definition={definition}
        height={height}
        ariaLabel={ariaLabel}
        className="otter-chart"
        renderTooltipBody={
          compact
            ? undefined
            : ({ points }) => <TooltipBody points={points} format={format} showTotal={stacked} />
        }
      />
    </div>
  );
}
