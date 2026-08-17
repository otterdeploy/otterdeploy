/**
 * Presentational pieces of the Analytics surface: headline-stat derivation,
 * the breakdown grids, and the small shared chrome (chart card, notes,
 * skeleton). Split from analytics-view.tsx so the view stays the small
 * orchestrator over queries and range state.
 */

import type { ReactNode } from "react";

import { Activity03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { formatBytes } from "@/features/resources/components/_shared/metrics/format";
import { Card } from "@/shared/components/ui/card";
import { Skeleton } from "@/shared/components/ui/skeleton";

import type { AnalyticsRangeKey, TopEntry } from "../analytics-model";
import type { Stat } from "./stat-strip";

import { formatCount, formatShare } from "../analytics-model";
import { StatusMix } from "./status-mix";
import { TopList } from "./top-list";
import { VisitorMap } from "./visitor-map";

export interface OverviewSummary {
  requests: number;
  botRequests: number;
  visitorDays: number;
  peakDayVisitors: number;
  bytesOut: number;
  avgLatencyMs: number | null;
  p95: number | null;
  errorRate: number;
  hostCount: number;
}

interface SparkBucket {
  requests: number;
  s4xx: number;
  s5xx: number;
  resBytes: number;
  p95: number | null;
}

export function headlineStats(summary: OverviewSummary, series: readonly SparkBucket[]): Stat[] {
  return [
    {
      label: "Requests",
      value: formatCount(summary.requests),
      sub:
        summary.requests > 0
          ? `${formatShare(summary.botRequests, summary.requests)} bots`
          : undefined,
      spark: series.map((b) => b.requests),
    },
    {
      label: "Visitor-days",
      value: formatCount(summary.visitorDays),
      sub:
        summary.peakDayVisitors > 0
          ? `peak day ${formatCount(summary.peakDayVisitors)}`
          : undefined,
      title:
        "Distinct visitors summed per UTC day (bots excluded). Per-day counts can't be merged into unique visitors for the whole window.",
    },
    {
      label: "Bandwidth out",
      value: formatBytes(summary.bytesOut),
      spark: series.map((b) => b.resBytes),
    },
    {
      label: "Latency",
      value: summary.p95 === null ? "–" : `${summary.p95} ms`,
      sub: summary.avgLatencyMs === null ? undefined : `avg ${summary.avgLatencyMs} ms`,
      title: "p95 over the window, from merged latency histograms.",
      spark: series.map((b) => b.p95 ?? 0),
    },
    {
      label: "Error rate",
      value: `${(summary.errorRate * 100).toFixed(summary.errorRate < 0.01 ? 2 : 1)}%`,
      sub: "4xx + 5xx",
      spark: series.map((b) => b.s4xx + b.s5xx),
    },
  ];
}

function sumCounts(entries: readonly { count: number }[]): number {
  return entries.reduce((s, e) => s + e.count, 0);
}

export interface BreakdownDims {
  statuses: TopEntry[];
  paths: TopEntry[];
  referrers: TopEntry[];
  countries: TopEntry[];
  browsers: TopEntry[];
  oses: TopEntry[];
  deviceTypes: TopEntry[];
  flags: { geoAvailable: boolean };
}

export function BreakdownPanels({
  dims,
  visitorDays,
}: {
  dims: BreakdownDims;
  visitorDays: number;
}) {
  return (
    <>
      <VisitorMap
        countries={dims.countries}
        visitorDays={visitorDays}
        geoAvailable={dims.flags.geoAvailable}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <StatusMix entries={dims.statuses} />
        <TopList
          title="Top paths"
          entries={dims.paths}
          total={sumCounts(dims.paths)}
          emptyNote="No paths recorded in this window."
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <TopList
          title="Referrers"
          entries={dims.referrers}
          total={sumCounts(dims.referrers)}
          visibleRows={5}
          emptyNote="No external referrers in this window."
        />
        <TopList
          title="Browsers"
          entries={dims.browsers}
          total={sumCounts(dims.browsers)}
          visibleRows={5}
          emptyNote="No browser traffic in this window."
        />
        <TopList
          title="Operating systems"
          entries={dims.oses}
          total={sumCounts(dims.oses)}
          visibleRows={5}
          emptyNote="No OS data in this window."
        />
        <TopList
          title="Devices"
          entries={dims.deviceTypes}
          total={sumCounts(dims.deviceTypes)}
          visibleRows={5}
          emptyNote="No device data in this window."
        />
      </div>
    </>
  );
}

export function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="px-4 pt-3 pb-2">
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="px-3 pb-3">{children}</div>
    </Card>
  );
}

export function HonestyNotes({
  approximate,
  breakdownDays,
  range,
}: {
  approximate: boolean;
  breakdownDays: number | undefined;
  range: AnalyticsRangeKey;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {approximate ? (
        <p className="text-xs text-muted-foreground">
          Visitor counts in this window are approximate: the visitor set was rebuilt after a
          restart or hit its memory cap, so some days undercount or double-count returning
          visitors.
        </p>
      ) : null}
      {range === "24h" && breakdownDays !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Breakdowns (statuses, paths, countries, devices) are per UTC day and cover the{" "}
          {breakdownDays} calendar day{breakdownDays === 1 ? "" : "s"} touching this window.
        </p>
      ) : null}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-32 items-center justify-center gap-2 px-4 text-xs text-muted-foreground">
      <HugeiconsIcon
        icon={Activity03Icon}
        strokeWidth={1.5}
        className="size-4 text-muted-foreground/60"
      />
      {children}
    </div>
  );
}

export function ViewSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-52 w-full rounded-xl" />
        <Skeleton className="h-52 w-full rounded-xl" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  );
}
