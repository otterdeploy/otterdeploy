/**
 * The one traffic-analytics surface: project-scoped on the project's
 * Analytics tab, install-wide on the org Edge page. Rollup-backed
 * (`edgeLogs.analytics.*`), so every range costs the same and the numbers
 * outlive the raw log's retention.
 *
 * Honesty over polish, same house rules as the metrics cards: approximate
 * visitor windows say so, breakdowns admit their UTC-day granularity, and a
 * missing GeoIP database reads as "geo isn't set up", never as "no visitors".
 */

import { useQuery } from "@tanstack/react-query";

import { MetricAreaChart } from "@/features/resources/components/_shared/metrics/metric-area-chart";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { orpc } from "@/shared/server/orpc";

import type { AnalyticsRangeKey } from "../analytics-model";

import { ANALYTICS_RANGES, formatCount, latencyRows, requestRows } from "../analytics-model";
import {
  BreakdownPanels,
  ChartCard,
  headlineStats,
  HonestyNotes,
  Note,
  ViewSkeleton,
} from "./analytics-view-parts";
import { StatStrip } from "./stat-strip";

const POLL_MS = 30_000;

interface AnalyticsViewProps {
  /** Scope to one project's domains; omitted ⇒ all the org's domains. */
  projectId?: string;
  range: AnalyticsRangeKey;
  onRangeChange: (range: AnalyticsRangeKey) => void;
}

function isRange(value: string): value is AnalyticsRangeKey {
  return ANALYTICS_RANGES.some((range) => range === value);
}

export function AnalyticsView({ projectId, range, onRangeChange }: AnalyticsViewProps) {
  const input = projectId === undefined ? { range } : { projectId, range };
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
      {/* The surrounding page/tab owns the title + description; this row owns
          only the window choice, so embedding the view never doubles copy. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ToggleGroup
          value={[range]}
          onValueChange={(next) => {
            const value = next[0];
            if (value !== undefined && isRange(value)) onRangeChange(value);
          }}
          variant="outline"
          size="sm"
          spacing={0}
        >
          {ANALYTICS_RANGES.map((key) => (
            <ToggleGroupItem
              key={key}
              value={key}
              aria-label={`Last ${key}`}
              className="px-2.5 font-mono text-xs"
            >
              {key}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {((): React.ReactNode => {
        if (overview.isLoading && !data) return <ViewSkeleton />;
        if (overview.isError && !data) return <Note>Couldn&apos;t load analytics. Retrying.</Note>;
        if (!data) return null;
        if (data.summary.hostCount === 0) {
          return <Note>No public domains yet. Analytics starts once a service is exposed.</Note>;
        }
        return (
          <>
            <StatStrip stats={headlineStats(data.summary)} />

            <div className="grid gap-3 md:grid-cols-2">
              <ChartCard title="Requests">
                {data.summary.requests === 0 ? (
                  <Note>No requests in this window.</Note>
                ) : (
                  <MetricAreaChart
                    data={requestRows(data.series)}
                    format={formatCount}
                    series={[
                      { dataKey: "requests", label: "Requests", color: "var(--chart-3)" },
                      { dataKey: "errors", label: "4xx+5xx", color: "var(--destructive)" },
                    ]}
                  />
                )}
              </ChartCard>
              <ChartCard title="Latency">
                {data.summary.p95 === null ? (
                  <Note>No requests in this window.</Note>
                ) : (
                  <MetricAreaChart
                    data={latencyRows(data.series)}
                    format={(v) => `${Math.round(v)} ms`}
                    series={[
                      { dataKey: "p99", label: "p99", color: "var(--chart-1)" },
                      { dataKey: "p95", label: "p95", color: "var(--chart-3)" },
                      { dataKey: "p50", label: "p50", color: "var(--chart-5)" },
                    ]}
                  />
                )}
              </ChartCard>
            </div>

            {dims ? <BreakdownPanels dims={dims} /> : null}

            <HonestyNotes
              approximate={data.flags.approximate}
              breakdownDays={dims?.breakdownDays}
              range={range}
            />
          </>
        );
      })()}
    </div>
  );
}
