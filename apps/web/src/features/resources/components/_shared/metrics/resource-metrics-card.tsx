/**
 * Compact metrics tile for one resource on the project-wide overview. Shows
 * the current CPU / memory / network reading plus a sparkline of the selected
 * window, and links through to the resource's node in the graph. Each card
 * owns its own `metrics.query` subscription (one per resource) so they refresh
 * independently in step with the sampler.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";

import { Card } from "@/shared/components/ui/card";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import {
  resourceToNode,
  type ProjectResource,
} from "@/features/projects/components/graph/resource-to-node";

import { formatBytes, formatPercent, formatRate } from "./format";
import { MetricAreaChart } from "./metric-area-chart";
import { useResourceMetrics } from "./use-resource-metrics";

const STATUS_DOT: Record<string, string> = {
  running: "bg-success",
  building: "bg-warning animate-pulse",
  error: "bg-destructive",
};

interface ResourceMetricsCardProps {
  resource: ProjectResource;
  orgSlug: string;
  projectSlug: string;
  windowMinutes: number;
}

export function ResourceMetricsCard({
  resource,
  orgSlug,
  projectSlug,
  windowMinutes,
}: ResourceMetricsCardProps) {
  const node = resourceToNode(resource).data;
  const { rows, summary, isLoading } = useResourceMetrics(
    resource.resourceId,
    windowMinutes,
  );
  const hasData = rows.length > 0;
  const latest = summary.latest;

  return (
    <Link
      to="/$orgSlug/$projectSlug/graph/$resourceId"
      params={{ orgSlug, projectSlug, resourceId: resource.resourceId }}
      className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Card className="gap-0 overflow-hidden p-0 transition-colors group-hover:border-foreground/20">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <PanelIcon node={node} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">
              {resource.name}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {node.description}
            </span>
          </div>
          {node.status ? (
            <span
              className={cn(
                "ml-auto size-2 shrink-0 rounded-full",
                STATUS_DOT[node.status] ?? "bg-muted-foreground/40",
              )}
              aria-label={node.status}
            />
          ) : null}
        </div>

        <div className="grid grid-cols-3 border-t border-border/60 divide-x divide-border/60">
          <MiniMetric
            label="CPU"
            value={hasData ? formatPercent(latest?.cpuPct ?? 0) : "—"}
            loading={isLoading && !hasData}
            chart={
              <MetricAreaChart
                compact
                data={rows}
                format={(v) => formatPercent(v)}
                series={[
                  { dataKey: "cpuPct", label: "CPU", color: "var(--chart-3)" },
                ]}
              />
            }
          />
          <MiniMetric
            label="Memory"
            value={hasData ? formatBytes(latest?.memBytes ?? 0) : "—"}
            loading={isLoading && !hasData}
            chart={
              <MetricAreaChart
                compact
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
            }
          />
          <MiniMetric
            label="Network"
            value={
              hasData ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="flex items-center gap-0.5">
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      strokeWidth={2.5}
                      className="size-3 text-muted-foreground"
                    />
                    {formatRate(summary.netRxLatest)}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <HugeiconsIcon
                      icon={ArrowUp01Icon}
                      strokeWidth={2.5}
                      className="size-3 text-muted-foreground"
                    />
                    {formatRate(summary.netTxLatest)}
                  </span>
                </span>
              ) : (
                "—"
              )
            }
            loading={isLoading && !hasData}
            chart={
              <MetricAreaChart
                compact
                data={rows}
                format={(v) => formatRate(v)}
                series={[
                  { dataKey: "netRxRate", label: "In", color: "var(--chart-3)" },
                  { dataKey: "netTxRate", label: "Out", color: "var(--chart-1)" },
                ]}
              />
            }
          />
        </div>
      </Card>
    </Link>
  );
}

function MiniMetric({
  label,
  value,
  chart,
  loading,
}: {
  label: string;
  value: ReactNode;
  chart: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-4 w-16 rounded" />
      ) : (
        <span className="font-mono text-sm font-medium tabular-nums">
          {value}
        </span>
      )}
      <div className="mt-0.5">
        {loading ? <Skeleton className="h-10 w-full rounded" /> : chart}
      </div>
    </div>
  );
}
