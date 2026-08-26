/**
 * The Traffic tab: the edge plane (Caddy access log) read through the
 * rollups (`edgeLogs.analytics.*`), so every range costs the same and the
 * numbers outlive the raw log's retention. Install-wide for admins,
 * org- or project-scoped via the page header's filters; the header owns the
 * range and maps it onto this plane's four presets.
 *
 * Layout is the Overview's vocabulary: stat tiles with deltas and sparks,
 * the requests chart, the latency chart, then the breakdown grid.
 */

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import type { EdgeWindow } from "../lib/range";

import {
  HonestyNotes,
  HostFilterChip,
  TrafficError,
  TrafficSkeleton,
  trafficTiles,
} from "./analytics-view-parts";
import { CollectionNotice } from "./collection-notice";
import { TrafficBreakdowns } from "./traffic-breakdowns";
import { TrafficCharts } from "./traffic-charts";
import { TrafficStatTiles } from "./traffic-stat-tiles";

const POLL_MS = 30_000;

interface AnalyticsViewProps {
  /** Scope to one project's domains; omitted ⇒ all the org's domains. */
  projectId?: string;
  /** Every host on the install, control plane included. Install-admin only:
   *  the server verifies; pass it only when the route context says admin. */
  installWide?: boolean;
  window: EdgeWindow;
  /** Single-domain filter, toggled from the Domains card. URL-owned. */
  hostFilter?: string;
  onHostFilterChange: (host: string | undefined) => void;
}

export function AnalyticsView({
  projectId,
  installWide,
  window: win,
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

  return (
    <div className="flex flex-col gap-3">
      {hostFilter !== undefined ? (
        <HostFilterChip host={hostFilter} onClear={() => onHostFilterChange(undefined)} />
      ) : null}

      {((): React.ReactNode => {
        if (overview.isLoading && !data) return <TrafficSkeleton />;
        if (overview.isError && !data) return <TrafficError />;
        if (!data) return null;

        // No blanket empty state: every panel renders its own, and the
        // CollectionNotice above says why the page is quiet when the reason
        // is not "nobody visited".
        const measuring = data.flags.sinkConfigured && data.flags.collecting;
        // A bucket is the sampling cadence here, so a window with no traffic
        // at all draws as a break rather than a floor of zeroes it never
        // measured.
        const bucketMs = data.bucketSeconds * 1000;
        return (
          <>
            <CollectionNotice
              sinkConfigured={data.flags.sinkConfigured}
              collecting={data.flags.collecting}
              geoAvailable={data.flags.geoAvailable}
              hasHosts={data.summary.hostCount > 0}
              requests={data.summary.requests}
            />

            <TrafficStatTiles
              tiles={trafficTiles(data.summary, data.series, data.previous, measuring)}
              bucketMs={bucketMs}
            />

            <TrafficCharts
              series={data.series}
              bucketMs={bucketMs}
              totalRequests={data.summary.requests}
              p95={data.summary.p95}
              avgLatencyMs={data.summary.avgLatencyMs}
            />

            <TrafficBreakdowns
              dims={dims}
              hostFilter={hostFilter}
              onHostFilterChange={onHostFilterChange}
            />

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
