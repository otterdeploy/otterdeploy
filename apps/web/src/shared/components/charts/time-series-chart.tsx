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

import type { ChartPoint } from "@tanstack/charts";

import { useMemo } from "react";

import { colorLegend, defineChart, areaY, lineY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react/tooltip";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleUtc } from "d3-scale";

import { dimmedSeriesColor, rankSeries, seriesColor } from "@/shared/lib/chart-series";
import { cn } from "@/shared/lib/utils";

import type { LongRow, TimeRow } from "./series-rows";

import { applyFilter, seriesTotals, toLongRows } from "./series-rows";
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
  /** Whitespace-separated terms. Matching series stay lit; the rest dim. */
  filter?: string;
  /** Upper Y bound. "auto" fits the data. */
  max?: number | "auto";
  /** Expected ms between samples. Drives gap detection; 0 disables it. */
  sampleIntervalMs?: number;
  /** Sparkline: no axes, no grid, no tooltip, no legend. */
  compact?: boolean;
  /** Legend under the plot. Defaults on above one series, off at one. */
  legend?: boolean;
  height?: number;
  className?: string;
}

const timeTick = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayTick = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** A window wider than about two days reads better as dates than as clock
 *  times; an axis of "02:00" repeated eleven times is noise, not a scale. */
const DAY_TICK_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

/** Hoisted so their literal types survive into the definition. */
const GROUP_X = "group-x" as const;
const TOOLTIP_PLACEMENT = ["top", "right", "left", "bottom"] as const;

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
  filter = "",
  max = "auto",
  sampleIntervalMs = 0,
  compact = false,
  legend,
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

    const span = data.length > 1 ? data[data.length - 1].ts - data[0].ts : 0;
    const tick = span >= DAY_TICK_THRESHOLD_MS ? dayTick : timeTick;

    const x = {
      scale: scaleUtc,
      nice: true,
      axis: compact
        ? false
        : { ticks: { spacing: 90, format: (value: Date) => tick.format(value) } },
    } as const;

    const y = {
      scale: scaleLinear,
      nice: true,
      grid: !compact,
      domain: max === "auto" ? undefined : [0, max],
      axis: compact ? false : { ticks: { count: 4, format: (value: number) => format(value) } },
    } as const;

    // One uniform shape whatever the mode. Branching the *shape* rather than
    // the values gives `defineChart` a union to infer through, and it declines.
    const interaction = {
      clip: true,
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

    if (stacked) {
      // Implicit stacking: repeated x positions stack by series when no
      // explicit y1/y2 is given. A stacked segment reports its own value in the
      // tooltip, not the cumulative endpoint.
      return defineChart({
        marks: [areaY(long, { id: "series", x: "t", y: "value", z: "series", fillOpacity: 0.55 })],
        x,
        y,
        color,
        ...interaction,
      });
    }

    // Overlaid: explicit y1/y2 endpoints opt out of the implicit stack, so the
    // fill is decoration under a line that owns interaction.
    return defineChart({
      marks: [
        decorative(
          areaY(long, {
            id: "series-fill",
            x: "t",
            y1: 0,
            y2: "value",
            z: "series",
            fillOpacity: 0.14,
          }),
        ),
        lineY(long, { id: "series-line", x: "t", y: "value", z: "series", strokeWidth: 1.75 }),
      ],
      x,
      y,
      color,
      ...interaction,
    });
  }, [data, series, format, stacked, filter, max, sampleIntervalMs, compact, legend]);

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
