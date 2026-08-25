/**
 * React-Query layer for the project metrics overview: `metrics.projectAggregate`
 * (CPU/memory summed across every container in the project) and
 * `edgeLogs.requestSeries` (bucketed rps + per-bucket p95 across the project's
 * public hosts). Both poll on the same window-aware cadence as the
 * per-resource hook (`use-resource-metrics`): sampler-locked while live.
 *
 * Honesty notes carried through from the server:
 * - Aggregate buckets nobody sampled are OMITTED by the server; this hook
 *   re-inserts them as `null` rows so the chart draws a gap, not a line
 *   soldering two measurements together.
 * - Request counts zero-fill (0 requests is a real measurement); p95 is null
 *   in an empty bucket.
 *
 * `projectId` is typed `string` and cast at the oRPC call boundary. Same
 * convention as `use-resource-metrics`.
 */

import { useQuery } from "@tanstack/react-query";

import { epochMsOf } from "@/shared/lib/clock";
import { orpc } from "@/shared/server/orpc";

import { METRIC_WINDOWS, refetchIntervalFor } from "./use-resource-metrics";

/** Metrics-page look-back windows. Extends the per-resource list with 7d.
 *  The real retention bound (`resource_metric` and the edge-log partitions
 *  are both pruned after 7 days). */
export const PROJECT_METRIC_WINDOWS = [
  ...METRIC_WINDOWS,
  { label: "7d", title: "Last 7 days", minutes: 10080, live: false },
] as const;

export type ProjectMetricWindowLabel = (typeof PROJECT_METRIC_WINDOWS)[number]["label"];

/** The per-resource detail query (`metrics.query`) caps at 24h; the grid
 *  clamps to this when a longer window is selected. */
export const RESOURCE_DETAIL_MAX_MINUTES = 1440;

// ─── Project CPU/memory aggregate ──────────────────────────────────────────

export interface AggregateRow {
  ts: number;
  /** Summed Docker-style CPU % (of one core); null = nobody sampled (gap). */
  cpuPct: number | null;
  /** Summed working-set bytes; null = nobody sampled (gap). */
  memBytes: number | null;
  /** Containers that reported in this bucket. */
  containers: number;
}

export interface AggregateSummary {
  latestCpuPct: number | null;
  latestMemBytes: number | null;
  latestContainers: number;
  cpuPeak: number;
  cpuAvg: number;
  memPeak: number;
  /** Buckets that actually carry a measurement. */
  sampleCount: number;
}

const EMPTY_AGGREGATE: AggregateSummary = {
  latestCpuPct: null,
  latestMemBytes: null,
  latestContainers: 0,
  cpuPeak: 0,
  cpuAvg: 0,
  memPeak: 0,
  sampleCount: 0,
};

export interface ProjectAggregateMetrics {
  rows: AggregateRow[];
  summary: AggregateSummary;
  isLoading: boolean;
  isError: boolean;
  updatedAt: number;
}

export function useProjectAggregateMetrics(
  projectId: string,
  windowMinutes: number,
): ProjectAggregateMetrics {
  const query = useQuery({
    ...orpc.metrics.projectAggregate.queryOptions({
      input: { projectId, windowMinutes },
    }),
    refetchInterval: refetchIntervalFor(windowMinutes),
    placeholderData: (prev) => prev,
  });

  const points = query.data?.points;
  const bucketSeconds = query.data?.bucketSeconds;

  const { rows, summary } = (() => {
    if (!points || points.length === 0 || !bucketSeconds) {
      const empty: AggregateRow[] = [];
      return { rows: empty, summary: EMPTY_AGGREGATE };
    }

    // Server buckets are sorted ascending and omit unsampled slots; re-insert
    // a single null row per gap so the area chart breaks the line there.
    const bucketMs = bucketSeconds * 1000;
    const rows: AggregateRow[] = [];
    let prevTs: number | null = null;
    for (const p of points) {
      const ts = epochMsOf(p.ts);
      if (prevTs !== null && ts - prevTs > bucketMs) {
        rows.push({ ts: prevTs + bucketMs, cpuPct: null, memBytes: null, containers: 0 });
      }
      rows.push({ ts, cpuPct: p.cpuPct, memBytes: p.memBytes, containers: p.containers });
      prevTs = ts;
    }

    const measured = rows.filter((r) => r.cpuPct !== null);
    const latest = measured[measured.length - 1];
    const cpuValues = measured.map((r) => r.cpuPct ?? 0);
    const summary: AggregateSummary = {
      latestCpuPct: latest?.cpuPct ?? null,
      latestMemBytes: latest?.memBytes ?? null,
      latestContainers: latest?.containers ?? 0,
      cpuPeak: Math.max(...cpuValues),
      cpuAvg: cpuValues.reduce((s, v) => s + v, 0) / cpuValues.length,
      memPeak: Math.max(...measured.map((r) => r.memBytes ?? 0)),
      sampleCount: measured.length,
    };
    return { rows, summary };
  })();

  return {
    rows,
    summary,
    isLoading: query.isLoading,
    isError: query.isError,
    updatedAt: query.dataUpdatedAt,
  };
}
