/**
 * React-Query layer over `metrics.query` — recent CPU / memory / network
 * samples for one resource. The server returns raw 30s samples (cumulative
 * network counters, Docker-style CPU percent); this hook derives the
 * per-second network rates and memory ratio the charts actually plot, and
 * rolls up window-level summary stats (latest / peak / average) for the
 * card headers.
 *
 * `resourceId` is typed `string` and cast at the oRPC call boundary
 * (`never` is assignable to any input type) — same convention as the data
 * viewer's `use-database` hooks.
 */

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

/** Look-back windows offered in the toolbar. Minutes feed `metrics.query`. */
export const METRIC_WINDOWS = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "3h", minutes: 180 },
  { label: "6h", minutes: 360 },
  { label: "12h", minutes: 720 },
  { label: "24h", minutes: 1440 },
] as const;

export type MetricWindowLabel = (typeof METRIC_WINDOWS)[number]["label"];

/** Sampler cadence (apps/server `startMetricsSampler`) — we refetch in step. */
const SAMPLE_INTERVAL_MS = 30_000;

/** One charted sample: server fields plus the derived ratio + rates. */
export interface MetricRow {
  ts: number;
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
  /** memBytes / memLimitBytes × 100 (0 when no limit is reported). */
  memPct: number;
  /** Bytes/sec inbound; null for the first sample and across counter resets. */
  netRxRate: number | null;
  /** Bytes/sec outbound; null for the first sample and across counter resets. */
  netTxRate: number | null;
}

export interface MetricSummary {
  latest: MetricRow | null;
  cpuPeak: number;
  cpuAvg: number;
  memPeak: number;
  memLimitBytes: number;
  netRxLatest: number | null;
  netTxLatest: number | null;
  sampleCount: number;
}

export interface ResourceMetrics {
  rows: MetricRow[];
  summary: MetricSummary;
  isLoading: boolean;
  isError: boolean;
  /** Epoch ms of the last successful fetch — drives the "updated" caption. */
  updatedAt: number;
}

const EMPTY_SUMMARY: MetricSummary = {
  latest: null,
  cpuPeak: 0,
  cpuAvg: 0,
  memPeak: 0,
  memLimitBytes: 0,
  netRxLatest: null,
  netTxLatest: null,
  sampleCount: 0,
};

export function useResourceMetrics(resourceId: string, windowMinutes: number): ResourceMetrics {
  const query = useQuery({
    ...orpc.metrics.query.queryOptions({
      input: { resourceId: resourceId as never, windowMinutes },
    }),
    // Poll in lockstep with the sampler so the panel trails real time by at
    // most one tick. `placeholderData` holds the previous series on screen
    // while a window change refetches, avoiding a flash to the empty state.
    refetchInterval: SAMPLE_INTERVAL_MS,
    placeholderData: (prev) => prev,
  });

  const points = query.data?.points;

  const { rows, summary } = useMemo(() => {
    if (!points || points.length === 0) {
      return { rows: [] as MetricRow[], summary: EMPTY_SUMMARY };
    }

    const rows: MetricRow[] = points.map((p, i) => {
      const ts = new Date(p.ts).getTime();
      const memPct = p.memLimitBytes > 0 ? (p.memBytes / p.memLimitBytes) * 100 : 0;

      let netRxRate: number | null = null;
      let netTxRate: number | null = null;
      if (i > 0) {
        const prev = points[i - 1];
        const dtSec = (ts - new Date(prev.ts).getTime()) / 1000;
        if (dtSec > 0) {
          const rx = (p.netRxBytes - prev.netRxBytes) / dtSec;
          const tx = (p.netTxBytes - prev.netTxBytes) / dtSec;
          // Counters reset to 0 on container restart → negative delta. Clamp
          // those to null so a restart reads as a gap, not a downward spike.
          netRxRate = rx >= 0 ? rx : null;
          netTxRate = tx >= 0 ? tx : null;
        }
      }

      return {
        ts,
        cpuPct: p.cpuPct,
        memBytes: p.memBytes,
        memLimitBytes: p.memLimitBytes,
        memPct,
        netRxRate,
        netTxRate,
      };
    });

    const latest = rows[rows.length - 1];
    const cpuSum = rows.reduce((acc, r) => acc + r.cpuPct, 0);
    const summary: MetricSummary = {
      latest,
      cpuPeak: Math.max(...rows.map((r) => r.cpuPct)),
      cpuAvg: cpuSum / rows.length,
      memPeak: Math.max(...rows.map((r) => r.memBytes)),
      memLimitBytes: latest.memLimitBytes,
      netRxLatest: latest.netRxRate,
      netTxLatest: latest.netTxRate,
      sampleCount: rows.length,
    };

    return { rows, summary };
  }, [points]);

  return {
    rows,
    summary,
    isLoading: query.isLoading,
    isError: query.isError,
    updatedAt: query.dataUpdatedAt,
  };
}
