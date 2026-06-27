/**
 * Metrics tab — live CPU / memory / network for one resource's containers,
 * fed by `metrics.query` (30s Docker-stats samples). A window selector drives
 * the look-back; the panel polls in step with the sampler so it trails real
 * time by at most one tick. Shared by the database and service detail panels.
 */

import { useState } from "react";

import {
  Activity03Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  CpuIcon,
  PulseIcon,
  RamMemoryIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";

import { formatBytes, formatClockSeconds, formatPercent, formatRate } from "./format";
import { MetricAreaChart } from "./metric-area-chart";
import { MetricCard } from "./metric-card";
import { METRIC_WINDOWS, useResourceMetrics, type MetricWindowLabel } from "./use-resource-metrics";

interface MetricsTabProps {
  resourceId: string;
}

export function MetricsTab({ resourceId }: MetricsTabProps) {
  const [window, setWindow] = useState<MetricWindowLabel>("30m");
  const minutes = METRIC_WINDOWS.find((w) => w.label === window)?.minutes ?? 30;

  const { rows, summary, isLoading, isError, updatedAt } = useResourceMetrics(resourceId, minutes);

  const hasData = rows.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar window={window} onWindowChange={setWindow} live={hasData} updatedAt={updatedAt} />

      {isLoading && !hasData ? (
        <LoadingState />
      ) : isError && !hasData ? (
        <ErrorState />
      ) : !hasData ? (
        <EmptyMetricsState />
      ) : (
        <div className="flex flex-col gap-3">
          {/* CPU — Docker-style percent of one core; can exceed 100% on
              multi-core hosts, so the axis is left to auto-fit. */}
          <MetricCard
            icon={CpuIcon}
            title="CPU"
            value={formatPercent(summary.latest?.cpuPct ?? 0)}
            stats={[
              { label: "peak", value: formatPercent(summary.cpuPeak) },
              { label: "avg", value: formatPercent(summary.cpuAvg) },
            ]}
          >
            <MetricAreaChart
              data={rows}
              format={(v) => formatPercent(v)}
              series={[{ dataKey: "cpuPct", label: "CPU", color: "var(--chart-3)" }]}
            />
          </MetricCard>

          {/* Memory — absolute working set; limit is shown as context since
              an unbounded container reports the host total as its limit. */}
          <MetricCard
            icon={RamMemoryIcon}
            title="Memory"
            value={formatBytes(summary.latest?.memBytes ?? 0)}
            stats={[
              { label: "peak", value: formatBytes(summary.memPeak) },
              { label: "limit", value: formatBytes(summary.memLimitBytes) },
            ]}
          >
            <MetricAreaChart
              data={rows}
              format={(v) => formatBytes(v)}
              series={[
                {
                  dataKey: "memBytes",
                  label: "Memory",
                  color: "var(--chart-3)",
                },
              ]}
            />
          </MetricCard>

          {/* Network — per-second throughput derived from cumulative counters;
              in and out overlaid on one axis. */}
          <MetricCard
            icon={Activity03Icon}
            title="Network"
            value={
              <div className="flex items-center gap-3 text-lg">
                <span className="flex items-center gap-1">
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    strokeWidth={2.5}
                    className="size-3.5 text-muted-foreground"
                  />
                  {formatRate(summary.netRxLatest)}
                </span>
                <span className="flex items-center gap-1">
                  <HugeiconsIcon
                    icon={ArrowUp01Icon}
                    strokeWidth={2.5}
                    className="size-3.5 text-muted-foreground"
                  />
                  {formatRate(summary.netTxLatest)}
                </span>
              </div>
            }
          >
            <MetricAreaChart
              data={rows}
              format={(v) => formatRate(v)}
              series={[
                { dataKey: "netRxRate", label: "In", color: "var(--chart-3)" },
                { dataKey: "netTxRate", label: "Out", color: "var(--chart-1)" },
              ]}
            />
          </MetricCard>
        </div>
      )}
    </div>
  );
}

function Toolbar({
  window,
  onWindowChange,
  live,
  updatedAt,
}: {
  window: MetricWindowLabel;
  onWindowChange: (w: MetricWindowLabel) => void;
  live: boolean;
  updatedAt: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ToggleGroup
        value={[window]}
        onValueChange={(next) => {
          const v = next[0];
          if (v) onWindowChange(v as MetricWindowLabel);
        }}
        variant="outline"
        size="sm"
        spacing={0}
      >
        {METRIC_WINDOWS.map((w) => (
          <ToggleGroupItem
            key={w.label}
            value={w.label}
            aria-label={`Last ${w.label}`}
            className="px-2.5 font-mono text-xs"
          >
            {w.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {live ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <HugeiconsIcon icon={PulseIcon} strokeWidth={2} className="size-3.5 text-success" />
          <span>Live · updated {updatedAt ? formatClockSeconds(updatedAt) : "—"}</span>
        </div>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[13.5rem] w-full rounded-xl" />
      ))}
    </div>
  );
}

function EmptyMetricsState() {
  return (
    <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
      <EmptyHeader>
        <HugeiconsIcon
          icon={Activity03Icon}
          strokeWidth={1.5}
          className="size-10 text-muted-foreground/50"
        />
        <EmptyTitle>No samples yet</EmptyTitle>
        <EmptyDescription>
          Metrics are sampled from the running containers every 30 seconds. Once this resource has
          been live for a tick or two, CPU, memory, and network will chart here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ErrorState() {
  return (
    <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
      <EmptyHeader>
        <HugeiconsIcon
          icon={Alert02Icon}
          strokeWidth={1.5}
          className="size-10 text-muted-foreground/50"
        />
        <EmptyTitle>Couldn’t load metrics</EmptyTitle>
        <EmptyDescription>
          The metrics query failed. It will retry automatically on the next refresh.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
