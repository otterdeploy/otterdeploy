/**
 * TanStack react-charts wrapper for the Analytics time series. One place owns
 * the library's sharp edges so panel code stays declarative:
 * - axis option objects are memoized (the Chart rebuilds every scale on
 *   identity change),
 * - empty data is short-circuited BEFORE the Chart mounts (the lib throws on
 *   data it can't infer a scale from),
 * - the parent box carries the explicit height the lib's ResizeObserver
 *   measurement requires,
 * - tooltips render through our own token-styled popover, not the lib's
 *   hardcoded dark box.
 * Tick/grid colors are themed globally in index.css (.ReactChart rules).
 */

import { useMemo } from "react";

import { Chart, type AxisOptions, type UserSerie } from "react-charts";

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
  className?: string;
}

const timeTick = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTick = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const tooltipStamp = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function AnalyticsChart({ series, kind, format, tickFace, className }: AnalyticsChartProps) {
  const data: UserSerie<ChartPoint>[] = useMemo(
    () => series.map((s) => ({ label: s.label, data: s.data })),
    [series],
  );

  const primaryAxis = useMemo<AxisOptions<ChartPoint>>(
    () => ({
      getValue: (datum) => datum.date,
      scaleType: "localTime",
      formatters: {
        scale: (value: Date | null) =>
          value === null ? "" : (tickFace === "time" ? timeTick : dateTick).format(value),
      },
    }),
    [tickFace],
  );

  const secondaryAxes = useMemo<AxisOptions<ChartPoint>[]>(
    () => [
      {
        getValue: (datum) => datum.value,
        scaleType: "linear",
        elementType: kind,
        // Explicit: `elementType: "area"` alone flips the stacker on, and
        // stacking coerces our honest null gaps into zeros.
        stacked: false,
        min: 0,
        formatters: { scale: (value: number | null) => (value === null ? "" : format(value)) },
      },
    ],
    [kind, format],
  );

  const colors = useMemo(() => series.map((s) => s.color), [series]);

  const hasData = series.some((s) => s.data.some((p) => (p.value ?? 0) > 0));
  if (!hasData) return null;

  return (
    <div className={className ?? "h-44"}>
      <Chart
        options={{
          data,
          primaryAxis,
          secondaryAxes,
          interactionMode: "primary",
          getSeriesStyle: (s) => ({
            color: colors[s.index] ?? "var(--primary)",
            line: { strokeWidth: 1.75 },
            area: { fillOpacity: 0.12, opacity: 1 },
          }),
          tooltip: {
            render: ({ focusedDatum }) => {
              if (!focusedDatum) return null;
              const group = focusedDatum.tooltipGroup ?? [focusedDatum];
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-mono text-[10px] text-muted-foreground">
                    {tooltipStamp.format(focusedDatum.primaryValue)}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.map((datum) => (
                      <div
                        key={datum.seriesLabel}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className="size-2 rounded-[2px]"
                            style={{ background: colors[datum.seriesIndex] }}
                          />
                          <span className="text-muted-foreground">{datum.seriesLabel}</span>
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {datum.secondaryValue == null ? "–" : format(datum.secondaryValue)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            },
          },
        }}
      />
    </div>
  );
}
