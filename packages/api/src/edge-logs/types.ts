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
  /** User-selected host subset (within the org scope above); empty ⇒ all. */
  selectedHosts?: string[];
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

// ─── Operational log plane (Phase 3) ──────────────────────────────────────
//
// The *other* Caddy log stream: not per-request access logs, but the proxy's
// own default logger — TLS/ACME lifecycle, reverse_proxy upstream errors, and
// config events. Shipped to the same sink via a global `log { output net }`
// (see docs/designs/edge-logs.md §7). One object per operational log line we
// keep (info-level noise that isn't cert/upstream is dropped at parse).

/** What an operational event is about. `cert` = TLS/ACME/OCSP lifecycle;
 *  `upstream` = reverse_proxy dial/stream errors; `config` = reload/admin;
 *  `other` = anything else we kept (warn/error level). */
export type EdgeEventCategory = "cert" | "upstream" | "config" | "other";
export type EdgeEventLevel = "debug" | "info" | "warn" | "error";

export interface EdgeEventLine {
  id: string;
  /** ISO-8601. */
  ts: string;
  level: EdgeEventLevel;
  category: EdgeEventCategory;
  /** Caddy logger name (e.g. `tls`, `http.handlers.reverse_proxy`). */
  logger: string;
  msg: string;
  /** Public domain this event is attributable to, when resolvable (the
   *  multi-tenant scope key — see the router). Null for batch/global events. */
  host: string | null;
  /** Domains named in a cert-management batch; redacted by the router to the
   *  caller's owned subset. */
  domains: string[];
  /** Selected upstream dial address, for reverse_proxy errors. */
  upstream: string | null;
  /** Error string, when the line carried one. */
  error: string | null;
  /** Sanitized raw JSON line (sensitive request headers stripped, capped) for
   *  the expandable detail view. */
  raw: string;
}

export interface EdgeEventFilter {
  /** Restrict to events attributable to these hosts (the caller's domains). */
  hosts: string[];
  range: EdgeTimeRange;
  /** Multi-select category/level filters; empty/undefined ⇒ no filter. */
  categories?: EdgeEventCategory[];
  levels?: EdgeEventLevel[];
  /** User-selected host subset (within the org scope above); empty ⇒ all. */
  selectedHosts?: string[];
  /** Free-text match across msg / host / upstream / error / logger. */
  search?: string;
  limit?: number;
}

export interface EdgeEventQueryResult {
  rows: EdgeEventLine[];
  total: number;
}
