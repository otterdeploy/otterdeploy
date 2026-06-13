/**
 * Edge access logs — the normalized shape the Caddy structured access log is
 * parsed into, shared by the ingest sink, the ring buffer, and the oRPC
 * surface. One object per HTTP request that hit the Caddy edge proxy.
 *
 * See docs/designs/edge-logs.md (planned).
 */

export type EdgeStatusBucket = "2xx" | "3xx" | "4xx" | "5xx";
export type EdgeTimeRange = "5m" | "1h" | "6h" | "24h" | "7d";

export interface EdgeLogLine {
  id: string;
  /** ISO-8601. */
  ts: string;
  method: string;
  host: string;
  path: string;
  status: number;
  latencyMs: number;
  clientIp: string;
  /** ISO country code, when GeoIP enrichment is available (Phase 2). */
  country: string | null;
  userAgent: string;
  referer: string;
  tlsVersion: string | null;
  tlsCipher: string | null;
  /** Selected upstream, when reverse_proxy logging is wired (Phase 2). */
  upstream: string | null;
  /** Cache result (HIT/MISS/BYPASS), when a cache layer sets a status header. */
  cache: string | null;
  reqBytes: number;
  resBytes: number;
  requestId: string | null;
  /** Request headers (sensitive ones stripped) for the headers preview. */
  headers: Record<string, string>;
}

export interface EdgeLogFilter {
  /** Restrict to these hosts (the caller's org-owned domains). */
  hosts: string[];
  range: EdgeTimeRange;
  /** Multi-select method/status filters; empty/undefined ⇒ no filter. */
  methods?: string[];
  statuses?: EdgeStatusBucket[];
  host?: string;
  /** Free-text match across path / client IP / status. */
  search?: string;
  limit?: number;
}

export interface EdgeHostStat {
  host: string;
  rps: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface EdgeHistogramBucket {
  /** ISO start of the bucket. */
  t: string;
  c2xx: number;
  c3xx: number;
  c4xx: number;
  c5xx: number;
}

export interface EdgeLogQueryResult {
  rows: EdgeLogLine[];
  histogram: EdgeHistogramBucket[];
  hostStats: EdgeHostStat[];
  total: number;
}
