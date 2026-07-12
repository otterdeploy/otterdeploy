/**
 * React-Query layer for the project metrics overview: `metrics.projectAggregate`
 * (CPU/memory summed across every container in the project) and
 * `edgeLogs.requestSeries` (bucketed rps + per-bucket p95 across the project's
 * public hosts). Both poll on the 30s sampler cadence like the per-resource
 * hook (`use-resource-metrics`).
 *
 * Honesty notes carried through from the server:
 * - Aggregate buckets nobody sampled are OMITTED by the server; this hook
 *   re-inserts them as `null` rows so the chart draws a gap, not a line
 *   soldering two measurements together.
 * - Request counts zero-fill (0 requests is a real measurement); p95 is null
 *   in an empty bucket.
 *
 * `projectId` is typed `string` and cast at the oRPC call boundary — same
 * convention as `use-resource-metrics`.
 */

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import { METRIC_WINDOWS } from "./use-resource-metrics";

/** Metrics-page look-back windows. Extends the per-resource list with 7d —
 *  the real retention bound (`resource_metric` and the edge-log partitions
 *  are both pruned after 7 days). */
export const PROJECT_METRIC_WINDOWS = [...METRIC_WINDOWS, { label: "7d", minutes: 10080 }] as const;

export type ProjectMetricWindowLabel = (typeof PROJECT_METRIC_WINDOWS)[number]["label"];

/** The per-resource detail query (`metrics.query`) caps at 24h; the grid
 *  clamps to this when a longer window is selected. */
export const RESOURCE_DETAIL_MAX_MINUTES = 1440;

const SAMPLE_INTERVAL_MS = 30_000;

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
      input: { projectId: projectId as never, windowMinutes },
    }),
    refetchInterval: SAMPLE_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });

  const points = query.data?.points;
  const bucketSeconds = query.data?.bucketSeconds;

  const { rows, summary } = useMemo(() => {
    if (!points || points.length === 0 || !bucketSeconds) {
      return { rows: [] as AggregateRow[], summary: EMPTY_AGGREGATE };
    }

    // Server buckets are sorted ascending and omit unsampled slots; re-insert
    // a single null row per gap so the area chart breaks the line there.
    const bucketMs = bucketSeconds * 1000;
    const rows: AggregateRow[] = [];
    let prevTs: number | null = null;
    for (const p of points) {
      const ts = new Date(p.ts).getTime();
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
  }, [points, bucketSeconds]);

  return {
    rows,
    summary,
    isLoading: query.isLoading,
    isError: query.isError,
    updatedAt: query.dataUpdatedAt,
  };
}

// ─── Request rate / p95 from the edge logs ─────────────────────────────────

export interface RequestRow {
  ts: number;
  /** Requests per second over the bucket (0 is a real measurement). */
  rps: number;
  /** Per-bucket p95 latency in ms; null when the bucket saw no requests. */
  p95: number | null;
}

export interface RequestSummary {
  /** Total requests in the window. */
  total: number;
  /** Window-average rps. */
  avgRps: number;
  peakRps: number;
  /** p95 of the most recent bucket that saw traffic. */
  latestP95: number | null;
  maxP95: number;
  /** Errors (status >= 400) / total; 0 when no traffic. */
  errorRate: number;
}

const EMPTY_REQUESTS: RequestSummary = {
  total: 0,
  avgRps: 0,
  peakRps: 0,
  latestP95: null,
  maxP95: 0,
  errorRate: 0,
};

export interface ProjectRequestMetrics {
  rows: RequestRow[];
  summary: RequestSummary;
  /** 0 ⇒ the project routes no public HTTP hosts — nothing can chart here. */
  hostCount: number;
  /** "ring" ⇒ served from the in-memory buffer (persistence off) — history
   *  is much shorter than the selected window may suggest. */
  source: "db" | "ring" | null;
  /** True when the fetch cap truncated the window (old buckets undercount). */
  sampled: boolean;
  isLoading: boolean;
  isError: boolean;
  updatedAt: number;
}

export function useProjectRequestSeries(
  projectId: string,
  windowMinutes: number,
): ProjectRequestMetrics {
  const query = useQuery({
    ...orpc.edgeLogs.requestSeries.queryOptions({
      input: { projectId: projectId as never, windowMinutes },
    }),
    refetchInterval: SAMPLE_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });

  const data = query.data;

  const { rows, summary } = useMemo(() => {
    const buckets = data?.buckets;
    if (!buckets || buckets.length === 0 || !data.bucketSeconds) {
      return { rows: [] as RequestRow[], summary: EMPTY_REQUESTS };
    }

    const rows: RequestRow[] = buckets.map((b) => ({
      ts: new Date(b.t).getTime(),
      rps: b.count / data.bucketSeconds,
      p95: b.p95,
    }));

    const total = buckets.reduce((s, b) => s + b.count, 0);
    const errors = buckets.reduce((s, b) => s + b.errCount, 0);
    const p95Values = buckets.map((b) => b.p95).filter((v): v is number => v !== null);
    const lastTraffic = [...buckets].reverse().find((b) => b.p95 !== null);
    const summary: RequestSummary = {
      total,
      avgRps: total / (buckets.length * data.bucketSeconds),
      peakRps: Math.max(...rows.map((r) => r.rps)),
      latestP95: lastTraffic?.p95 ?? null,
      maxP95: p95Values.length > 0 ? Math.max(...p95Values) : 0,
      errorRate: total > 0 ? errors / total : 0,
    };
    return { rows, summary };
  }, [data]);

  return {
    rows,
    summary,
    hostCount: data?.hostCount ?? 0,
    source: data?.source ?? null,
    sampled: data?.sampled ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    updatedAt: query.dataUpdatedAt,
  };
}
