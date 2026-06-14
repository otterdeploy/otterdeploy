/**
 * In-memory edge-log store: a bounded ring buffer plus a live pub/sub.
 *
 * v1 keeps recent access logs in process (no DB) — this powers the live tail
 * and the 5m–1h histogram/percentile windows directly. Longer ranges
 * (24h/7d) and survival across restarts need persistence — see
 * docs/edge-logs.md "Phase 2". The ring is a module singleton: one edge
 * proxy, one process.
 */

import type {
  EdgeHistogramBucket,
  EdgeHostStat,
  EdgeLogFilter,
  EdgeLogLine,
  EdgeLogQueryResult,
  EdgeStatusBucket,
  EdgeTimeRange,
} from "./types";

/** ~last hour at a few hundred rps, or a hard cap — whichever is smaller. */
const MAX_ENTRIES = 50_000;

export const RANGE_MS: Record<EdgeTimeRange, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};

type Subscriber = (line: EdgeLogLine) => void;

// State lives on globalThis so the long-lived edge-log sink (a Bun.listen
// whose data-handler closure is captured at first boot) and the freshly
// re-imported query/persist modules all share ONE buffer + subscriber set
// across `--hot` reloads. Module-local state would diverge — the sink would
// push into a stale buffer the query never reads, silently breaking ingest.
const state = ((globalThis as typeof globalThis & {
  __edgeLogRing?: { buffer: EdgeLogLine[]; subscribers: Set<Subscriber> };
}).__edgeLogRing ??= { buffer: [], subscribers: new Set<Subscriber>() });

export function pushEdgeLog(line: EdgeLogLine): void {
  state.buffer.push(line);
  if (state.buffer.length > MAX_ENTRIES) state.buffer.shift();
  for (const fn of state.subscribers) fn(line);
}

/** Subscribe to live entries. Returns an unsubscribe fn. */
export function subscribeEdgeLogs(fn: Subscriber): () => void {
  state.subscribers.add(fn);
  return () => state.subscribers.delete(fn);
}

export function bucketOf(status: number): EdgeStatusBucket {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

function matches(line: EdgeLogLine, f: EdgeLogFilter, sinceMs: number): boolean {
  if (Date.parse(line.ts) < sinceMs) return false;
  if (!f.hosts.includes(line.host)) return false;
  if (f.selectedHosts?.length && !f.selectedHosts.includes(line.host)) return false;
  if (f.methods?.length && !f.methods.includes(line.method)) return false;
  if (f.statuses?.length && !f.statuses.includes(bucketOf(line.status))) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay =
      `${line.path} ${line.clientIp} ${line.status} ${line.method}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

export function queryEdgeLogs(filter: EdgeLogFilter, now: number): EdgeLogQueryResult {
  const sinceMs = now - RANGE_MS[filter.range];
  const matched = state.buffer.filter((l) => matches(l, filter, sinceMs));
  return summarizeEdgeLogs(matched, filter.range, now, filter.limit ?? 200);
}

/**
 * Compute rows + histogram + per-host stats from an already-filtered set of
 * lines. Shared by the in-memory ring (queryEdgeLogs) and the DB-backed
 * query (query-db.ts), so both produce identical shapes from the same math.
 */
export function summarizeEdgeLogs(
  matched: EdgeLogLine[],
  range: EdgeTimeRange,
  now: number,
  limit: number,
): EdgeLogQueryResult {
  const windowMs = RANGE_MS[range];
  const sinceMs = now - windowMs;

  // Rows: newest first, capped.
  const rows = matched.slice(-limit).reverse();

  // Histogram: ~40 buckets across the window.
  const bucketCount = 40;
  const bucketMs = Math.max(1000, Math.floor(windowMs / bucketCount));
  const buckets = new Map<number, EdgeHistogramBucket>();
  for (let i = 0; i < bucketCount; i++) {
    const t = sinceMs + i * bucketMs;
    buckets.set(t, {
      t: new Date(t).toISOString(),
      c2xx: 0,
      c3xx: 0,
      c4xx: 0,
      c5xx: 0,
    });
  }
  for (const l of matched) {
    const slot = sinceMs + Math.floor((Date.parse(l.ts) - sinceMs) / bucketMs) * bucketMs;
    const b = buckets.get(slot);
    if (!b) continue;
    const k = bucketOf(l.status);
    if (k === "2xx") b.c2xx++;
    else if (k === "3xx") b.c3xx++;
    else if (k === "4xx") b.c4xx++;
    else b.c5xx++;
  }

  // Per-host stats over the window.
  const byHost = new Map<string, { latencies: number[]; errors: number }>();
  for (const l of matched) {
    let h = byHost.get(l.host);
    if (!h) {
      h = { latencies: [], errors: 0 };
      byHost.set(l.host, h);
    }
    h.latencies.push(l.latencyMs);
    if (l.status >= 400) h.errors++;
  }
  const windowSeconds = windowMs / 1000;
  const hostStats: EdgeHostStat[] = [...byHost.entries()].map(([host, h]) => {
    const sorted = [...h.latencies].sort((a, b) => a - b);
    return {
      host,
      rps: +(h.latencies.length / windowSeconds).toFixed(2),
      errorRate: +(h.errors / h.latencies.length).toFixed(4),
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    };
  });

  return {
    rows,
    histogram: [...buckets.values()],
    hostStats,
    total: matched.length,
  };
}

/** Test seam — drain the buffer between tests. */
export function __resetEdgeLogs(): void {
  state.buffer.length = 0;
  state.subscribers.clear();
}
