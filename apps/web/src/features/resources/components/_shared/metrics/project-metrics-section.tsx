/**
 * Project-aggregate metrics overview: CPU and memory summed across every
 * container in the project (`metrics.projectAggregate`). Traffic and latency
 * moved to the Analytics tab (edge-stat rollups), which answers them over any
 * window instead of this page's capped edge-log scan.
 *
 * Honesty over polish: aggregate buckets nobody sampled render as gaps,
 * never zero-filled.
 */

import type { ReactNode } from "react";

import { Activity03Icon, CpuIcon, RamMemoryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useParams } from "@tanstack/react-router";

import { Skeleton } from "@/shared/components/ui/skeleton";

import { formatBytes, formatPercent } from "./format";
import { MetricAreaChart } from "./metric-area-chart";
import { MetricCard, type MetricStat } from "./metric-card";
import { useProjectAggregateMetrics } from "./use-project-metrics";

interface ProjectMetricsSectionProps {
  projectId: string;
  windowMinutes: number;
}

export function ProjectMetricsSection({ projectId, windowMinutes }: ProjectMetricsSectionProps) {
  const { orgSlug, projectSlug } = useParams({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const agg = useProjectAggregateMetrics(projectId, windowMinutes);

  const aggHasData = agg.rows.length > 0;

  const aggBody = (chart: ReactNode): ReactNode => {
    if (agg.isLoading && !aggHasData) return <ChartSkeleton />;
    if (agg.isError && !aggHasData) return <ChartNote>Couldn’t load samples. Retrying.</ChartNote>;
    if (!aggHasData) {
      return <ChartNote>No samples in this window yet. Sampled every 30s.</ChartNote>;
    }
    return chart;
  };

  const containerStat: MetricStat[] = aggHasData
    ? [{ label: "containers", value: String(agg.summary.latestContainers) }]
    : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 md:grid-cols-2">
        {/* CPU: sum of Docker-style per-container percents (of one core), so
            the project total can exceed 100% and the axis auto-fits. */}
        <MetricCard
          icon={CpuIcon}
          title="CPU"
          value={agg.summary.latestCpuPct != null ? formatPercent(agg.summary.latestCpuPct) : "–"}
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

        {/* Memory, summed working-set bytes across reporting containers. */}
        <MetricCard
          icon={RamMemoryIcon}
          title="Memory"
          value={agg.summary.latestMemBytes != null ? formatBytes(agg.summary.latestMemBytes) : "–"}
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

      </div>

      <p className="text-xs text-muted-foreground">
        Traffic, latency, and visitors moved to the{" "}
        <Link
          to="/$orgSlug/$projectSlug/analytics"
          params={{ orgSlug, projectSlug }}
          search={{ range: "24h" }}
          className="text-foreground underline-offset-2 hover:underline"
        >
          Analytics tab
        </Link>
        .
      </p>
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
