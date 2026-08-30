/**
 * React-Query layer over `metrics.query`: recent CPU / memory / network
 * samples for one resource. The server returns raw 30s samples (cumulative
 * network counters, Docker-style CPU percent); this hook derives the
 * per-second network rates and memory ratio the charts actually plot, and
 * rolls up window-level summary stats (latest / peak / average) for the
 * card headers.
 *
 * `resourceId` is typed `string` and cast at the oRPC call boundary
 * (`never` is assignable to any input type). Same convention as the data
 * viewer's `use-database` hooks.
 */

import { useQuery } from "@tanstack/react-query";

import { epochMsOf } from "@/shared/lib/clock";
import { orpc } from "@/shared/server/orpc";

/**
 * Look-back windows offered in the toolbar. Minutes feed `metrics.query`.
 *
 * The short windows are **live**: they poll in step with the sampler so the
 * newest sample lands within one tick. A day-long window has nothing to gain
 * from a refresh every half minute (one new point on a 2,880-point axis), so
 * it refreshes on a slower cadence and spares the query.
 */
export const METRIC_WINDOWS = [
  { label: "10m", title: "Last 10 minutes", minutes: 10, live: true },
  { label: "30m", title: "Last 30 minutes", minutes: 30, live: true },
  { label: "1h", title: "Last hour", minutes: 60, live: false },
  { label: "3h", title: "Last 3 hours", minutes: 180, live: false },
  { label: "6h", title: "Last 6 hours", minutes: 360, live: false },
  { label: "12h", title: "Last 12 hours", minutes: 720, live: false },
  { label: "24h", title: "Last 24 hours", minutes: 1440, live: false },
] as const;

export type MetricWindowLabel = (typeof METRIC_WINDOWS)[number]["label"];

/** Sampler cadence (apps/server `startMetricsSampler`): live windows refetch
 *  in step with it.
 *
 *  This is the REFETCH cadence only. It is not the spacing of the series —
 *  the server buckets, and a pass that overruns its tick skips one — so the
 *  charts take `bucketMs` off the response instead of assuming this. */
const SAMPLE_INTERVAL_MS = 30_000;

/** Refetch cadence for the non-live windows. */
export const HISTORY_REFETCH_MS = 5 * 60_000;

/** Widest window that still counts as live. */
export const LIVE_WINDOW_MAX_MINUTES = 30;

export function isLiveWindow(windowMinutes: number): boolean {
  return windowMinutes <= LIVE_WINDOW_MAX_MINUTES;
}

/** Poll cadence for a window: sampler-locked while live, relaxed otherwise. */
export function refetchIntervalFor(windowMinutes: number): number {
  return isLiveWindow(windowMinutes) ? SAMPLE_INTERVAL_MS : HISTORY_REFETCH_MS;
}

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
  /** Server-side bucket width. Feeds the charts' gap detection: anything
   *  wider than this is genuinely missing data, not the sampler's cadence. */
  bucketMs: number;
  isLoading: boolean;
  isError: boolean;
  /** Epoch ms of the last successful fetch. Drives the "updated" caption. */
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
      input: { resourceId, windowMinutes },
    }),
    // Live windows poll in lockstep with the sampler so the panel trails real
    // time by at most one tick. `placeholderData` holds the previous series on
    // screen while a window change refetches, avoiding a flash to the empty
    // state.
    refetchInterval: refetchIntervalFor(windowMinutes),
    placeholderData: (prev) => prev,
  });

  const points = query.data?.points;
  // Until the first response lands there is nothing to draw, so the nominal
  // cadence is a fine stand-in for the bucket width.
  const bucketMs = (query.data?.bucketSeconds ?? 30) * 1000;

  const { rows, summary } = (() => {
    if (!points || points.length === 0) {
      const empty: MetricRow[] = [];
      return { rows: empty, summary: EMPTY_SUMMARY };
    }

    const rows: MetricRow[] = points.map((p, i) => {
      const ts = epochMsOf(p.ts);
      const memPct = p.memLimitBytes > 0 ? (p.memBytes / p.memLimitBytes) * 100 : 0;

      let netRxRate: number | null = null;
      let netTxRate: number | null = null;
      if (i > 0) {
        const prev = points[i - 1];
        const dtSec = (ts - epochMsOf(prev.ts)) / 1000;
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
  })();

  return {
    rows,
    summary,
    bucketMs,
    isLoading: query.isLoading,
    isError: query.isError,
    updatedAt: query.dataUpdatedAt,
  };
}
