/**
 * Time-series area chart for one resource metric. Thin wrapper over recharts
 * (via the shared `ChartContainer`) that handles the bits every metric chart
 * shares: a soft gradient fill per series, an epoch-ms time axis, a unit-aware
 * Y axis, and a tooltip whose values run through the metric's own formatter.
 *
 * One or more series can be overlaid (e.g. network in/out) — each gets its own
 * `--color-<key>` token wired through the chart config.
 */

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/shared/components/ui/chart";
import { cn } from "@/shared/lib/utils";

import type { MetricRow } from "./use-resource-metrics";

import { formatClock } from "./format";

export interface MetricSeries {
  /** Key into `MetricRow` to plot. */
  dataKey: keyof MetricRow;
  /** Legend / tooltip label. */
  label: string;
  /** CSS color (e.g. `var(--chart-3)`). */
  color: string;
}

interface MetricAreaChartProps {
  data: MetricRow[];
  series: MetricSeries[];
  /** Formats Y-axis ticks and tooltip values (bytes, percent, rate…). */
  format: (value: number) => string;
  /** Upper Y bound; `"auto"` lets recharts fit the data (default). */
  max?: number | "auto";
  /** Sparkline mode — strips axes, grid, and tooltip for overview cards. */
  compact?: boolean;
  className?: string;
}

export function MetricAreaChart({
  data,
  series,
  format,
  max = "auto",
  compact = false,
  className,
}: MetricAreaChartProps) {
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [s.dataKey, { label: s.label, color: s.color }]),
  );

  const gradients = (
    <defs>
      {series.map((s) => (
        <linearGradient key={s.dataKey} id={`fill-${s.dataKey}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`var(--color-${s.dataKey})`} stopOpacity={0.28} />
          <stop offset="100%" stopColor={`var(--color-${s.dataKey})`} stopOpacity={0.02} />
        </linearGradient>
      ))}
    </defs>
  );

  const areas = series.map((s) => (
    <Area
      key={s.dataKey}
      dataKey={s.dataKey}
      type="monotone"
      stroke={`var(--color-${s.dataKey})`}
      strokeWidth={1.75}
      fill={`url(#fill-${s.dataKey})`}
      connectNulls={false}
      isAnimationActive={false}
      dot={false}
      activeDot={compact ? false : { r: 3, strokeWidth: 0 }}
    />
  ));

  if (compact) {
    return (
      <ChartContainer config={config} className={cn("aspect-auto h-10 w-full", className)}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          {gradients}
          {areas}
        </AreaChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer config={config} className={cn("aspect-auto h-40", className)}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        {gradients}

        <CartesianGrid vertical={false} strokeDasharray="3 3" />

        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
          tickFormatter={formatClock}
        />
        <YAxis
          domain={[0, max]}
          tickLine={false}
          axisLine={false}
          width={48}
          tickMargin={4}
          tickCount={4}
          tickFormatter={(v: number) => format(v)}
        />

        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => formatClock(Number(payload?.[0]?.payload?.ts))}
              formatter={(value, name, item) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ background: item.color }}
                    />
                    <span className="text-muted-foreground">
                      {(name != null ? config[name]?.label : undefined) ?? name}
                    </span>
                  </div>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {value == null ? "—" : format(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />

        {areas}
      </AreaChart>
    </ChartContainer>
  );
}
