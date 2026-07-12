/**
 * Pure bucketing for the `edgeLogs.requestSeries` procedure: fold already
 * host-scoped edge-log lines into ~40 fixed time buckets carrying request
 * count, error count (status >= 400), and per-bucket p95 latency.
 *
 * Mirrors the histogram math in edge-logs/ring.ts (same bucket count, same
 * floor-division slotting, same nearest-rank percentile) so the request-rate
 * chart and the edge-logs histogram never disagree about the same traffic.
 *
 * The window is expressed in minutes (the metrics page's selector), not the
 * store's range enum — `coveringRange` picks the smallest enum range that
 * covers the window for the fetch, and the bucketer drops lines older than
 * the exact window. Counts zero-fill (0 requests is a real measurement);
 * p95 is null for an empty bucket (a percentile of nothing isn't 0 ms).
 */

import type { EdgeTimeRange } from "../../edge-logs/types";

import { RANGE_MS } from "../../edge-logs/ring";

/** The fields the bucketer needs from an edge-log line. */
export interface RequestSeriesLine {
  /** ISO-8601. */
  ts: string;
  status: number;
  latencyMs: number;
}

export interface RequestSeriesBucket {
  /** ISO start of the bucket. */
  t: string;
  count: number;
  errCount: number;
  p95: number | null;
}

const RANGES_ASC: EdgeTimeRange[] = ["5m", "1h", "6h", "24h", "7d"];

/** Smallest store range that covers the window (fetch scope; the bucketer
 *  then trims to the exact window). Falls back to the full 7d retention. */
export function coveringRange(windowMinutes: number): EdgeTimeRange {
  const ms = windowMinutes * 60_000;
  for (const range of RANGES_ASC) {
    if (RANGE_MS[range] >= ms) return range;
  }
  return "7d";
}

/** Nearest-rank percentile over an ascending-sorted array — identical to the
 *  (unexported) helper in edge-logs/ring.ts. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export function bucketRequestSeries(
  lines: RequestSeriesLine[],
  windowMinutes: number,
  now: number,
): { buckets: RequestSeriesBucket[]; bucketSeconds: number } {
  const windowMs = windowMinutes * 60_000;
  const sinceMs = now - windowMs;

  // Same shape as the ring histogram: ~40 buckets, never finer than 1s.
  const bucketCount = 40;
  const bucketMs = Math.max(1000, Math.floor(windowMs / bucketCount));
  const slots = Math.max(1, Math.ceil(windowMs / bucketMs));

  const latencies: number[][] = Array.from({ length: slots }, () => []);
  const errors: number[] = Array.from({ length: slots }, () => 0);

  for (const line of lines) {
    const tsMs = Date.parse(line.ts);
    if (!Number.isFinite(tsMs) || tsMs < sinceMs || tsMs > now) continue;
    // Clamp the boundary spill (tsMs === now on the last partial bucket)
    // into the final slot instead of dropping the newest requests.
    const idx = Math.min(slots - 1, Math.floor((tsMs - sinceMs) / bucketMs));
    latencies[idx]?.push(line.latencyMs);
    if (line.status >= 400 && errors[idx] !== undefined) errors[idx] += 1;
  }

  const buckets: RequestSeriesBucket[] = latencies.map((bucketLatencies, i) => {
    const sorted = [...bucketLatencies].sort((a, b) => a - b);
    return {
      t: new Date(sinceMs + i * bucketMs).toISOString(),
      count: bucketLatencies.length,
      errCount: errors[i] ?? 0,
      p95: bucketLatencies.length > 0 ? percentile(sorted, 95) : null,
    };
  });

  return { buckets, bucketSeconds: bucketMs / 1000 };
}
