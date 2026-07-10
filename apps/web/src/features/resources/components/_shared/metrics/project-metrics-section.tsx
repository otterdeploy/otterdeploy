/**
 * Project-aggregate metrics overview — the four headline cards at the top of
 * the metrics page: CPU and memory summed across every container in the
 * project (`metrics.projectAggregate`), and request rate / p95 latency across
 * all of the project's public hosts (`edgeLogs.requestSeries`).
 *
 * Honesty over polish: aggregate buckets nobody sampled render as gaps (never
 * zero-filled), request cards say so when the project has no public hosts,
 * and a ring-buffer-served window longer than its real history is labeled.
 */

import type { ReactNode } from "react";

import {
  Activity03Icon,
  Clock01Icon,
  CpuIcon,
  EarthIcon,
  RamMemoryIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Skeleton } from "@/shared/components/ui/skeleton";

import { formatBytes, formatPercent } from "./format";
import { MetricAreaChart } from "./metric-area-chart";
import { MetricCard, type MetricStat } from "./metric-card";
import { useProjectAggregateMetrics, useProjectRequestSeries } from "./use-project-metrics";

/** Requests/second, one decimal under 10 for readable small rates. */
function formatRps(v: number): string {
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}/s`;
}

function formatMs(v: number): string {
  return `${Math.round(v)} ms`;
}

interface ProjectMetricsSectionProps {
  projectId: string;
  windowMinutes: number;
}

export function ProjectMetricsSection({ projectId, windowMinutes }: ProjectMetricsSectionProps) {
  const agg = useProjectAggregateMetrics(projectId, windowMinutes);
  const req = useProjectRequestSeries(projectId, windowMinutes);

  const aggHasData = agg.rows.length > 0;
  const reqHasTraffic = req.summary.total > 0;

  const aggBody = (chart: ReactNode): ReactNode => {
    if (agg.isLoading && !aggHasData) return <ChartSkeleton />;
    if (agg.isError && !aggHasData) return <ChartNote>Couldn’t load samples — retrying.</ChartNote>;
    if (!aggHasData) {
      return <ChartNote>No samples in this window yet — sampled every 30s.</ChartNote>;
    }
    return chart;
  };

  const reqBody = (chart: ReactNode): ReactNode => {
    if (req.isLoading && req.rows.length === 0) return <ChartSkeleton />;
    if (req.isError && req.rows.length === 0) {
      return <ChartNote>Couldn’t load edge logs — retrying.</ChartNote>;
    }
    if (req.hostCount === 0) {
      return <ChartNote>No public traffic — services are internal.</ChartNote>;
    }
    if (!reqHasTraffic) return <ChartNote>No requests in this window.</ChartNote>;
    return chart;
  };

  const containerStat: MetricStat[] = aggHasData
    ? [{ label: "containers", value: String(agg.summary.latestContainers) }]
    : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 md:grid-cols-2">
        {/* CPU — sum of Docker-style per-container percents (of one core), so
            the project total can exceed 100% and the axis auto-fits. */}
        <MetricCard
          icon={CpuIcon}
          title="CPU"
          value={agg.summary.latestCpuPct != null ? formatPercent(agg.summary.latestCpuPct) : "—"}
          stats={
            aggHasData
              ? [
                  { label: "peak", value: formatPercent(agg.summary.cpuPeak) },
                  { label: "avg", value: formatPercent(agg.summary.cpuAvg) },
                  ...containerStat,
                ]
              : []
          }
        >
          {aggBody(
            <MetricAreaChart
              data={agg.rows}
              format={(v) => formatPercent(v)}
              series={[{ dataKey: "cpuPct", label: "CPU", color: "var(--chart-3)" }]}
            />,
          )}
        </MetricCard>

        {/* Memory — summed working-set bytes across reporting containers. */}
        <MetricCard
          icon={RamMemoryIcon}
          title="Memory"
          value={agg.summary.latestMemBytes != null ? formatBytes(agg.summary.latestMemBytes) : "—"}
          stats={aggHasData ? [{ label: "peak", value: formatBytes(agg.summary.memPeak) }] : []}
        >
          {aggBody(
            <MetricAreaChart
              data={agg.rows}
              format={(v) => formatBytes(v)}
              series={[{ dataKey: "memBytes", label: "Memory", color: "var(--chart-3)" }]}
            />,
          )}
        </MetricCard>

        {/* Request rate — bucketed rps from the edge access logs across every
            public host the project routes. Zero is a real measurement. */}
        <MetricCard
          icon={EarthIcon}
          title="Request rate"
          value={reqHasTraffic ? formatRps(req.summary.avgRps) : "—"}
          stats={
            reqHasTraffic
              ? [
                  { label: "peak", value: formatRps(req.summary.peakRps) },
                  {
                    label: "errors",
                    value: `${(req.summary.errorRate * 100).toFixed(1)}%`,
                  },
                ]
              : []
          }
        >
          {reqBody(
            <MetricAreaChart
              data={req.rows}
              format={formatRps}
              series={[{ dataKey: "rps", label: "Requests", color: "var(--chart-3)" }]}
            />,
          )}
        </MetricCard>

        {/* P95 latency — per-bucket p95 from the same edge-log window; empty
            buckets are gaps (a percentile of zero requests doesn't exist). */}
        <MetricCard
          icon={Clock01Icon}
          title="P95 latency"
          value={req.summary.latestP95 != null ? formatMs(req.summary.latestP95) : "—"}
          stats={reqHasTraffic ? [{ label: "max", value: formatMs(req.summary.maxP95) }] : []}
        >
          {reqBody(
            <MetricAreaChart
              data={req.rows}
              format={formatMs}
              series={[{ dataKey: "p95", label: "p95", color: "var(--chart-1)" }]}
            />,
          )}
        </MetricCard>
      </div>

      {req.source === "ring" && windowMinutes > 60 ? (
        <p className="text-xs text-muted-foreground">
          Edge-log persistence is off — request cards only cover the in-memory buffer, which is
          shorter than the selected window.
        </p>
      ) : null}
      {req.sampled ? (
        <p className="text-xs text-muted-foreground">
          High traffic volume — request cards are computed over the most recent 10,000 requests, so
          the oldest buckets may undercount.
        </p>
      ) : null}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="px-3 pb-2">
      <Skeleton className="h-40 w-full rounded-md" />
    </div>
  );
}

function ChartNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-40 items-center justify-center gap-2 px-4 text-xs text-muted-foreground">
      <HugeiconsIcon
        icon={Activity03Icon}
        strokeWidth={1.5}
        className="size-4 text-muted-foreground/60"
      />
      {children}
    </div>
  );
}
