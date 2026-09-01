/**
 * The host metric panels: CPU (total or user/system/iowait/steal breakdown),
 * load against the core count, memory with cache and swap, disk I/O and
 * network throughput. Each is a `MetricCard` around one `TimeSeriesChart`
 * over the per-node series; the tab decides the window and which state to
 * show. Per-core usage has no history (the series stores the host total) so
 * it renders as meters from the latest report.
 */
import { formatBytes } from "@otterdeploy/shared/format";

import type { ServerMetricRow, ServerMetricSummary } from "@/features/servers/detail/use-server-metrics";

import { MetricCard } from "@/features/resources/components/_shared/metrics/metric-card";
import { formatPercent } from "@/features/resources/components/_shared/metrics/format";
import { TimeSeriesChart } from "@/shared/components/charts/time-series-chart";
import { Meter } from "@/shared/components/ui/meter";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";

const HEIGHT = 200;
const CPU_COLOR = "var(--chart-cpu)";
const MEMORY_COLOR = "var(--chart-memory)";

interface PanelProps {
  rows: ServerMetricRow[];
  sampleIntervalMs: number;
}

export type CpuMode = "total" | "breakdown";

function rate(v: number | null | undefined): string {
  return v == null ? "–" : `${formatBytes(Math.round(v))}/s`;
}

/** Axis tick for a throughput chart. Whole bytes only: an idle host's axis
 *  runs 0–1 B/s and `formatBytes` has no unit for 0.8 of a byte. */
function rateTick(v: number): string {
  return `${formatBytes(Math.max(0, Math.round(v)))}/s`;
}

/** An idle box would otherwise get a 0–1 B/s axis; 1 KB/s is the smallest
 *  ceiling that reads as a real scale. */
const RATE_AXIS_FLOOR = 1024;

function rateAxisMax(rows: readonly ServerMetricRow[], keys: readonly ("diskReadBps" | "diskWriteBps" | "netRxBps" | "netTxBps")[]): number {
  let max = 0;
  for (const row of rows) for (const key of keys) max = Math.max(max, row[key] ?? 0);
  return Math.max(RATE_AXIS_FLOOR, max * 1.1);
}

export function CpuPanel({
  rows,
  summary,
  sampleIntervalMs,
  mode,
  onMode,
}: PanelProps & { summary: ServerMetricSummary; mode: CpuMode; onMode: (m: CpuMode) => void }) {
  const latest = summary.latest?.cpuPct ?? null;
  return (
    <MetricCard
      title="CPU"
      swatch={CPU_COLOR}
      value={latest === null ? "–" : formatPercent(latest, 0)}
      stats={[
        { label: "peak", value: summary.cpuPeak === null ? "–" : formatPercent(summary.cpuPeak, 0) },
        { label: "avg", value: summary.cpuAvg === null ? "–" : formatPercent(summary.cpuAvg, 0) },
      ]}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11.5px] text-muted-foreground">
          {mode === "breakdown"
            ? "iowait and steal tell a busy box from a busy neighbour"
            : "share of every core, from the host's /proc/stat"}
        </span>
        <ToggleGroup
          value={[mode]}
          onValueChange={(next) => {
            if (next[0] === "total" || next[0] === "breakdown") onMode(next[0]);
          }}
          variant="outline"
          size="sm"
          spacing={0}
        >
          <ToggleGroupItem value="total" className="px-2.5 text-xs">
            Total
          </ToggleGroupItem>
          <ToggleGroupItem value="breakdown" className="px-2.5 text-xs">
            Breakdown
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {mode === "breakdown" ? (
        <TimeSeriesChart
          stacked
          height={HEIGHT}
          max={100}
          data={rows}
          ariaLabel="CPU time by class over the selected window"
          format={(v) => formatPercent(v, 0)}
          sampleIntervalMs={sampleIntervalMs}
          series={[
            { dataKey: "cpuUserPct", label: "user" },
            { dataKey: "cpuSystemPct", label: "system" },
            { dataKey: "cpuIowaitPct", label: "iowait" },
            { dataKey: "cpuStealPct", label: "steal" },
          ]}
        />
      ) : (
        <TimeSeriesChart
          smooth
          height={HEIGHT}
          max={100}
          data={rows}
          ariaLabel="CPU usage over the selected window"
          format={(v) => formatPercent(v, 0)}
          sampleIntervalMs={sampleIntervalMs}
          series={[{ dataKey: "cpuPct", label: "CPU", color: CPU_COLOR }]}
        />
      )}
    </MetricCard>
  );
}

export function PerCoreGrid({ perCore }: { perCore: readonly number[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-3 lg:grid-cols-4">
      {perCore.map((pct, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">core {i}</span>
          <Meter value={pct} label={`core ${i}`} className="flex-1" />
        </div>
      ))}
    </div>
  );
}

export function LoadPanel({ rows, sampleIntervalMs, cores }: PanelProps & { cores: number }) {
  const latest = rows.at(-1);
  return (
    <MetricCard
      title="Load"
      value={latest?.loadAvg1 == null ? "–" : latest.loadAvg1.toFixed(2)}
      stats={[
        { label: "5m", value: latest?.loadAvg5 == null ? "–" : latest.loadAvg5.toFixed(2) },
        { label: "15m", value: latest?.loadAvg15 == null ? "–" : latest.loadAvg15.toFixed(2) },
        { label: "cores", value: cores > 0 ? String(cores) : "–" },
      ]}
    >
      <TimeSeriesChart
        kind="line"
        height={HEIGHT}
        data={rows}
        ariaLabel="Load average over the selected window"
        format={(v) => v.toFixed(1)}
        sampleIntervalMs={sampleIntervalMs}
        series={[
          { dataKey: "loadAvg1", label: "1 min" },
          { dataKey: "loadAvg5", label: "5 min" },
          { dataKey: "loadAvg15", label: "15 min" },
        ]}
      />
    </MetricCard>
  );
}

export function MemoryPanel({ rows, sampleIntervalMs }: PanelProps) {
  const latest = rows.at(-1);
  return (
    <MetricCard
      title="Memory"
      swatch={MEMORY_COLOR}
      value={latest ? formatPercent(latest.memUsedPct, 0) : "–"}
      stats={[
        { label: "cache", value: latest?.memCachedPct == null ? "–" : formatPercent(latest.memCachedPct, 0) },
        { label: "swap", value: latest?.swapUsedPct == null ? "–" : formatPercent(latest.swapUsedPct, 0) },
      ]}
    >
      <TimeSeriesChart
        smooth
        height={HEIGHT}
        max={100}
        data={rows}
        ariaLabel="Memory usage over the selected window"
        format={(v) => formatPercent(v, 0)}
        sampleIntervalMs={sampleIntervalMs}
        series={[
          { dataKey: "memUsedPct", label: "used", color: MEMORY_COLOR },
          { dataKey: "memCachedPct", label: "cache" },
          { dataKey: "swapUsedPct", label: "swap" },
        ]}
      />
    </MetricCard>
  );
}

export function DiskIoPanel({ rows, sampleIntervalMs }: PanelProps) {
  const latest = rows.at(-1);
  return (
    <MetricCard
      title="Disk I/O"
      value={rate(latest?.diskReadBps)}
      stats={[{ label: "write", value: rate(latest?.diskWriteBps) }]}
    >
      <TimeSeriesChart
        kind="line"
        height={HEIGHT}
        max={rateAxisMax(rows, ["diskReadBps", "diskWriteBps"])}
        data={rows}
        ariaLabel="Disk throughput over the selected window"
        format={rateTick}
        sampleIntervalMs={sampleIntervalMs}
        series={[
          { dataKey: "diskReadBps", label: "read" },
          { dataKey: "diskWriteBps", label: "write" },
        ]}
      />
    </MetricCard>
  );
}

export function NetworkPanel({ rows, sampleIntervalMs }: PanelProps) {
  const latest = rows.at(-1);
  return (
    <MetricCard
      title="Network"
      value={`↓ ${rate(latest?.netRxBps)}`}
      stats={[{ label: "out", value: `↑ ${rate(latest?.netTxBps)}` }]}
    >
      <TimeSeriesChart
        kind="line"
        height={HEIGHT}
        max={rateAxisMax(rows, ["netRxBps", "netTxBps"])}
        data={rows}
        ariaLabel="Network throughput over the selected window"
        format={rateTick}
        sampleIntervalMs={sampleIntervalMs}
        series={[
          { dataKey: "netRxBps", label: "in" },
          { dataKey: "netTxBps", label: "out" },
        ]}
      />
    </MetricCard>
  );
}
