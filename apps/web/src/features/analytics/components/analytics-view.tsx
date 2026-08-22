/**
 * The one traffic-analytics surface: install-wide on the top-level Analytics
 * page (admins), org- or project-scoped via the page's filters. Rollup-backed
 * (`edgeLogs.analytics.*`), so every range costs the same and the numbers
 * outlive the raw log's retention.
 *
 * Layout follows the Plausible shape: stat cards with trend deltas, one
 * full-width hero chart, then the map and the breakdowns.
 */

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { TimeSeriesChart } from "@/shared/components/charts/time-series-chart";
import { orpc } from "@/shared/server/orpc";

import type { AnalyticsWindowSel } from "./range-picker";

import { formatCount } from "../analytics-model";
import {
  BreakdownPanels,
  ChartCard,
  headlineStats,
  HonestyNotes,
  Note,
  ViewSkeleton,
} from "./analytics-view-parts";
import { RangePicker } from "./range-picker";
import { StatStrip } from "./stat-strip";

const POLL_MS = 30_000;

interface AnalyticsViewProps {
  /** Scope to one project's domains; omitted ⇒ all the org's domains. */
  projectId?: string;
  /** Every host on the install, control plane included. Install-admin only:
   *  the server verifies; pass it only when the route context says admin. */
  installWide?: boolean;
  window: AnalyticsWindowSel;
  onWindowChange: (next: AnalyticsWindowSel) => void;
  /** Single-domain filter, toggled from the Domains panel. URL-owned. */
  hostFilter?: string;
  onHostFilterChange: (host: string | undefined) => void;
}

export function AnalyticsView({
  projectId,
  installWide,
  window: win,
  onWindowChange,
  hostFilter,
  onHostFilterChange,
}: AnalyticsViewProps) {
  const windowInput =
    win.range === "custom" && win.from !== undefined && win.to !== undefined
      ? ({ range: "24h", from: win.from, to: win.to } as const)
      : ({ range: win.range === "custom" ? "24h" : win.range } as const);
  const scopeInput = installWide
    ? ({ installWide: true } as const)
    : projectId === undefined
      ? {}
      : ({ projectId } as const);
  const input =
    hostFilter === undefined
      ? { ...scopeInput, ...windowInput }
      : { ...scopeInput, ...windowInput, host: hostFilter };

  const overview = useQuery({
    ...orpc.edgeLogs.analytics.overview.queryOptions({ input }),
    refetchInterval: POLL_MS,
    placeholderData: (prev) => prev,
  });
  const breakdowns = useQuery({
    ...orpc.edgeLogs.analytics.breakdowns.queryOptions({ input }),
    refetchInterval: POLL_MS,
    placeholderData: (prev) => prev,
  });

  const data = overview.data;
  const dims = breakdowns.data;
  const wireSeries = data?.series;

  // Wide rows straight off the wire: the chart folds them per series itself.
  const requestRows = useMemo(
    () =>
      (wireSeries ?? []).map((b) => ({
        ts: new Date(b.t).getTime(),
        requests: b.requests,
        errors: b.s4xx + b.s5xx,
      })),
    [wireSeries],
  );
  const latencyRows = useMemo(
    () =>
      (wireSeries ?? []).map((b) => ({
        ts: new Date(b.t).getTime(),
        p50: b.p50,
        p95: b.p95,
        p99: b.p99,
      })),
    [wireSeries],
  );

  // A bucket is the sampling cadence here, so a window with no traffic at all
  // draws as a break rather than a floor of zeroes it never measured.
  const bucketMs = (data?.bucketSeconds ?? 0) * 1000;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {hostFilter !== undefined ? (
            <button
              type="button"
              onClick={() => onHostFilterChange(undefined)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs hover:bg-muted/60"
              title="Clear the domain filter"
            >
              {hostFilter}
              <span aria-hidden className="text-muted-foreground">
                ×
              </span>
            </button>
          ) : null}
        </div>
        <RangePicker value={win} onChange={onWindowChange} />
      </div>

      {((): React.ReactNode => {
        if (overview.isLoading && !data) return <ViewSkeleton />;
        if (overview.isError && !data) return <Note>Couldn&apos;t load analytics. Retrying.</Note>;
        if (!data) return null;
        if (data.summary.hostCount === 0) {
          return installWide ? (
            <Note>No traffic recorded in this window.</Note>
          ) : (
            <Note>No public domains yet. Analytics starts once a service is exposed.</Note>
          );
        }
        return (
          <>
            <StatStrip stats={headlineStats(data.summary, data.series, data.previous)} />

            {/* The hero: requests over the window, full width. */}
            <ChartCard title="Requests">
              {data.summary.requests === 0 ? (
                <Note>No requests in this window.</Note>
              ) : (
                <TimeSeriesChart
                  data={requestRows}
                  ariaLabel="Requests and errors over time"
                  format={formatCount}
                  height={280}
                  sampleIntervalMs={bucketMs}
                  series={[
                    { dataKey: "requests", label: "Requests", color: "var(--primary)" },
                    { dataKey: "errors", label: "4xx + 5xx", color: "var(--destructive)" },
                  ]}
                />
              )}
            </ChartCard>

            {dims ? (
              <BreakdownPanels
                dims={dims}
                visitorDays={data.summary.visitorDays}
                hostFilter={hostFilter}
                onHostFilterChange={onHostFilterChange}
              />
            ) : null}

            {/* Percentiles share an axis but not a baseline, so they draw as
                lines: three overlapping fills read as one quantity rather than
                three readings. The ramp runs light-to-dark with the percentile,
                so the tail is the darkest line on the chart. */}
            <ChartCard title="Latency">
              {data.summary.p95 === null ? (
                <Note>No requests in this window.</Note>
              ) : (
                <TimeSeriesChart
                  data={latencyRows}
                  ariaLabel="Latency percentiles over time"
                  format={(v) => `${Math.round(v)} ms`}
                  height={200}
                  kind="line"
                  sampleIntervalMs={bucketMs}
                  series={[
                    { dataKey: "p99", label: "p99", color: "var(--chart-5)" },
                    { dataKey: "p95", label: "p95", color: "var(--chart-3)" },
                    { dataKey: "p50", label: "p50", color: "var(--chart-1)" },
                  ]}
                />
              )}
            </ChartCard>

            <HonestyNotes
              approximate={data.flags.approximate}
              breakdownDays={dims?.breakdownDays}
              shortWindow={data.bucketSeconds < 86_400}
            />
          </>
        );
      })()}
    </div>
  );
}
