/**
 * The three per-resource metric panels — CPU, memory, network — each a
 * `MetricCard` around one full-width `TimeSeriesChart`. The tab decides
 * which state to show; these only know how to draw a window of samples.
 *
 * CPU and memory take their fixed hues (`--chart-cpu`, `--chart-memory`) so
 * the same colour means the same thing on every surface that draws them.
 */

import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { TimeSeriesChart } from "@/shared/components/charts/time-series-chart";

import { formatBytes, formatPercent, formatRate } from "./format";
import { MetricCard } from "./metric-card";
import { SAMPLE_INTERVAL_MS, type MetricRow, type MetricSummary } from "./use-resource-metrics";

const CHART_HEIGHT = 220;
export const CPU_COLOR = "var(--chart-cpu)";
export const MEMORY_COLOR = "var(--chart-memory)";

interface PanelProps {
  rows: MetricRow[];
  summary: MetricSummary;
}

/** Docker-style percent of one core; can exceed 100% on multi-core hosts, so
 *  the axis is left to auto-fit. */
export function CpuPanel({ rows, summary }: PanelProps) {
  return (
    <MetricCard
      title="CPU usage"
      swatch={CPU_COLOR}
      value={formatPercent(summary.latest?.cpuPct ?? 0, 1)}
      stats={[
        { label: "peak", value: formatPercent(summary.cpuPeak, 1) },
        { label: "avg", value: formatPercent(summary.cpuAvg, 1) },
      ]}
    >
      <TimeSeriesChart
        smooth
        height={CHART_HEIGHT}
        data={rows}
        ariaLabel="CPU usage over the selected window"
        format={(v) => formatPercent(v, 1)}
        sampleIntervalMs={SAMPLE_INTERVAL_MS}
        series={[{ dataKey: "cpuPct", label: "CPU", color: CPU_COLOR }]}
      />
    </MetricCard>
  );
}

/**
 * Working set as a share of the container's limit, with the absolute figures
 * in the header for the reader who thinks in bytes.
 *
 * An unbounded container reports the host total as its limit, and one with
 * no limit at all reports 0. Percent of 0 is nothing, so that case charts the
 * working set in bytes instead.
 */
export function MemoryPanel({ rows, summary }: PanelProps) {
  const latest = summary.latest;
  const asPercent = summary.memLimitBytes > 0;

  if (!asPercent) {
    return (
      <MetricCard
        title="Memory usage"
        swatch={MEMORY_COLOR}
        value={formatBytes(latest?.memBytes ?? 0)}
        stats={[{ label: "peak", value: formatBytes(summary.memPeak) }]}
      >
        <TimeSeriesChart
          smooth
          height={CHART_HEIGHT}
          data={rows}
          ariaLabel="Memory usage over the selected window"
          format={(v) => formatBytes(v)}
          sampleIntervalMs={SAMPLE_INTERVAL_MS}
          series={[{ dataKey: "memBytes", label: "Memory", color: MEMORY_COLOR }]}
        />
      </MetricCard>
    );
  }

  return (
    <MetricCard
      title="Memory usage"
      swatch={MEMORY_COLOR}
      value={formatPercent(latest?.memPct ?? 0, 1)}
      stats={[
        { label: "used", value: formatBytes(latest?.memBytes ?? 0) },
        { label: "peak", value: formatBytes(summary.memPeak) },
        { label: "limit", value: formatBytes(summary.memLimitBytes) },
      ]}
    >
      <TimeSeriesChart
        smooth
        height={CHART_HEIGHT}
        data={rows}
        ariaLabel="Memory usage as a share of the limit over the selected window"
        format={(v) => formatPercent(v, 1)}
        sampleIntervalMs={SAMPLE_INTERVAL_MS}
        series={[{ dataKey: "memPct", label: "Memory", color: MEMORY_COLOR }]}
      />
    </MetricCard>
  );
}

/** Per-second throughput derived from cumulative counters. In and out are
 *  not parts of one total, so they overlay rather than stack; the wheel
 *  gives each a distinguishable hue. */
export function NetworkPanel({ rows, summary }: PanelProps) {
  return (
    <MetricCard
      title="Network"
      value={
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2.5}
              className="size-3 text-muted-foreground"
            />
            {formatRate(summary.netRxLatest)}
          </span>
          <span className="flex items-center gap-1">
            <HugeiconsIcon
              icon={ArrowUp01Icon}
              strokeWidth={2.5}
              className="size-3 text-muted-foreground"
            />
            {formatRate(summary.netTxLatest)}
          </span>
        </span>
      }
    >
      <TimeSeriesChart
        smooth
        height={CHART_HEIGHT}
        data={rows}
        ariaLabel="Network throughput over the selected window"
        format={(v) => formatRate(v)}
        sampleIntervalMs={SAMPLE_INTERVAL_MS}
        series={[
          { dataKey: "netRxRate", label: "In" },
          { dataKey: "netTxRate", label: "Out" },
        ]}
      />
    </MetricCard>
  );
}
