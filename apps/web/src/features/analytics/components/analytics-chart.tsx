/**
 * TanStack Charts (@tanstack/charts) wrapper for the Analytics time series.
 * One place owns the library's conventions so panel code stays declarative:
 * per-series input is folded to the long rows the color scale wants, areas
 * get explicit y1/y2 endpoints (the default is an implicit stack) with a
 * decorative fill under an interaction-owning line, focus is group-x so the
 * tooltip lists every series at the hovered x, and axis/grid/tooltip colors
 * ride currentColor + the CSS variables set in index.css (.analytics-chart),
 * so themes need zero JS.
 */

import { useMemo } from "react";

import { colorLegend, defineChart, areaY, lineY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react/tooltip";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleUtc } from "d3-scale";

export interface ChartPoint {
  date: Date;
  value: number | null;
}

export interface ChartSeriesDef {
  label: string;
  /** Any CSS color, tokens included ("var(--primary)"). */
  color: string;
  data: ChartPoint[];
}

interface AnalyticsChartProps {
  series: ChartSeriesDef[];
  kind: "area" | "line";
  /** Formats tooltip + y-axis values (counts, ms, bytes…). */
  format: (value: number) => string;
  /** Bucket granularity decides the tick face: times for sub-day buckets,
   *  dates for day buckets (a 90d axis of "02:00 AM" repeated is noise). */
  tickFace: "time" | "date";
  ariaLabel: string;
  height?: number;
}

interface LongRow {
  t: Date;
  series: string;
  value: number | null;
}

const timeTick = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTick = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const tooltipStamp = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function AnalyticsChart({
  series,
  kind,
  format,
  tickFace,
  ariaLabel,
  height = 200,
}: AnalyticsChartProps) {
  const definition = useMemo(() => {
    // Per-series props → long rows, row-major per series so each path keeps
    // chronological order. Nulls survive: the line mark renders them as gaps.
    const long: LongRow[] = series.flatMap((s) =>
      s.data.map((p) => ({ t: p.date, series: s.label, value: p.value })),
    );
    const tick = tickFace === "time" ? timeTick : dateTick;

    // Shared spec pieces. Marks stay per-branch: a union-typed marks array
    // defeats defineChart's inference, so each kind calls it directly.
    const x = {
      scale: scaleUtc,
      nice: true,
      axis: { ticks: { spacing: 90, format: (value: Date) => tick.format(value) } },
    } as const;
    const y = {
      scale: scaleLinear,
      nice: true,
      grid: true,
      axis: { ticks: { count: 4, format: (value: number) => format(value) } },
    } as const;
    const color = {
      domain: series.map((s) => s.label),
      range: series.map((s) => s.color),
      legend: series.length > 1 ? colorLegend({ placement: "bottom" }) : undefined,
    };
    const interaction = {
      clip: true,
      focus: "group-x",
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        placement: ["top", "right", "left", "bottom"],
        sort: "color-domain",
        items: [
          { channel: "x", text: (p: { xValue: Date }) => tooltipStamp.format(p.xValue) },
          { channel: "group" },
          {
            channel: "y",
            text: (p: { yValue: number | null }) => (p.yValue === null ? "–" : format(p.yValue)),
          },
        ],
      },
    } as const;

    const line = lineY(long, {
      id: "series-line",
      x: "t",
      y: "value",
      z: "series",
      strokeWidth: 1.75,
    });

    if (kind === "area") {
      return defineChart({
        // Fill only, no interaction points; explicit y1/y2 endpoints keep the
        // areas OVERLAID (the default is an implicit stack).
        marks: [
          decorative(
            areaY(long, {
              id: "series-area",
              x: "t",
              y1: 0,
              y2: "value",
              z: "series",
              fillOpacity: 0.14,
            }),
          ),
          line,
        ],
        x,
        y,
        color,
        ...interaction,
      });
    }
    return defineChart({ marks: [line], x, y, color, ...interaction });
  }, [series, kind, format, tickFace]);

  const hasData = series.some((s) => s.data.some((p) => (p.value ?? 0) > 0));
  if (!hasData) return null;

  return (
    <Chart definition={definition} height={height} ariaLabel={ariaLabel} className="otter-chart" />
  );
}
