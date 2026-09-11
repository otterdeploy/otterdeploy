/**
 * Edge access logs contract: live tail (event-iterator) + a range query
 * powering the volume histogram and per-host percentile footer. Org-scoped:
 * the server restricts to the caller's own domains; clients never pass hosts.
 */

import { eventIterator, oc } from "@orpc/contract";
import { zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import { feedInput, feedOutput } from "../../lib/table";

const tag = "edge-logs";

const edgeLogLineSchema = z.object({
  id: z.string(),
  ts: z.string(),
  method: z.string(),
  host: z.string(),
  path: z.string(),
  status: z.number(),
  latencyMs: z.number(),
  clientIp: z.string(),
  country: z.string().nullable(),
  userAgent: z.string(),
  referer: z.string(),
  tlsVersion: z.string().nullable(),
  tlsCipher: z.string().nullable(),
  upstream: z.string().nullable(),
  cache: z.string().nullable(),
  reqBytes: z.number(),
  resBytes: z.number(),
  requestId: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
});

const timeRange = z.enum(["5m", "1h", "6h", "24h", "7d"]);
const statusBucket = z.enum(["2xx", "3xx", "4xx", "5xx"]);

export const edgeLogQueryInput = z
  .object({
    /** Restrict to one project's domains; omitted ⇒ all the org's domains. */
    projectId: zId("prj").optional(),
    range: timeRange.default("1h"),
    /** Custom window (epoch ms), overriding `range`. Both or neither. Capped
     *  at 7 days: the edge-log retention window (persist.ts RETENTION_DAYS),
     *  so a wider ask can't pretend to cover data that no longer exists. */
    from: z.number().int().positive().optional(),
    to: z.number().int().positive().optional(),
    /** Multi-select method/status/host filters; empty/omitted ⇒ no filter. */
    methods: z.array(z.string()).optional(),
    statuses: z.array(statusBucket).optional(),
    hosts: z.array(z.string()).optional(),
    search: z.string().optional(),
    /** Narrow to scanner probes. Applied in SQL/the ring, not on the returned
     *  page: the row cap would otherwise decide the answer. */
    suspicious: z.boolean().optional(),
    limit: z.number().int().positive().max(1000).optional(),
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: "from and to must be provided together",
  })
  .refine((v) => v.from === undefined || v.to === undefined || v.from < v.to, {
    message: "from must be before to",
  })
  .refine(
    (v) => v.from === undefined || v.to === undefined || v.to - v.from <= 7 * 24 * 60 * 60 * 1000,
    { message: "window must be 7 days or less" },
  );

const edgeLogTailInput = z.object({
  projectId: zId("prj").optional(),
  host: z.string().optional(),
});

const edgeHistogramBucketSchema = z.object({
  t: z.string(),
  c2xx: z.number(),
  c3xx: z.number(),
  c4xx: z.number(),
  c5xx: z.number(),
});

const edgeHostStatSchema = z.object({
  host: z.string(),
  rps: z.number(),
  errorRate: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
});

const edgeLogQueryResultSchema = z.object({
  rows: z.array(edgeLogLineSchema),
  histogram: z.array(edgeHistogramBucketSchema),
  hostStats: z.array(edgeHostStatSchema),
  /** Over the whole window, not `rows.length` (which `limit` caps). */
  total: z.number(),
  suspiciousTotal: z.number(),
  suspiciousIps: z.array(z.string()),
});

// ─── Per-route traffic stats (graph edges + stack Traffic tab) ─────────────

/** Short windows only: this powers a ~10s poll on the project graph, so the
 *  cheap ring/DB scan stays cheap. Longer forensics live in `query`. */
const routeStatsRange = z.enum(["5m", "1h"]);

const routeStatsInput = z.object({
  projectId: zId("prj"),
  range: routeStatsRange.default("5m"),
});

/** One row per public host routed by this project: traffic stats over the
 *  window, zero-filled when the host saw no requests, so consumers can list
 *  every host honestly and mark the quiet ones as quiet. */
const routeStatSchema = z.object({
  /** Canonical host (lowercase, no port): matches serviceResource.publicDomain. */
  host: z.string(),
  /** Owning resource (service/database): null for routes without one. */
  resourceId: zId("res").nullable(),
  /** True for the resource's canonical host (mirrors publicDomain). */
  isPrimary: z.boolean(),
  rps: z.number(),
  errorRate: z.number(),
  p50: z.number(),
  p95: z.number(),
});

// ─── Bucketed request series (project metrics overview) ───────────────────

/** Minutes rather than the enum so it lines up with the metrics page's window
 *  selector exactly. Max 7d = edge-log DB retention (persist.ts drops daily
 *  partitions after RETENTION_DAYS = 7); when persistence is off the ring
 *  holds far less, which `source: "ring"` lets the UI label honestly. */
const requestSeriesInput = z.object({
  projectId: zId("prj"),
  windowMinutes: z.number().int().positive().max(10080).default(60),
});

/** One time bucket across ALL of the project's public hosts. `count` is a
 *  real measurement even at 0 (no requests genuinely means 0 rps), so counts
 *  are zero-filled; `p95` of zero requests doesn't exist, so it's null. */
const requestSeriesBucketSchema = z.object({
  /** ISO start of the bucket. */
  t: z.string(),
  count: z.number(),
  /** Requests with status >= 400. */
  errCount: z.number(),
  /** Per-bucket p95 latency (ms); null when the bucket saw no requests. */
  p95: z.number().nullable(),
});

const requestSeriesResultSchema = z.object({
  buckets: z.array(requestSeriesBucketSchema),
  bucketSeconds: z.number(),
  /** Public HTTP hosts routed by the project; 0 ⇒ nothing can appear here. */
  hostCount: z.number(),
  /** Which store served the window. "ring" means short in-memory history. */
  source: z.enum(["db", "ring"]),
  /** True when the fetch cap truncated the window (oldest buckets undercount). */
  sampled: z.boolean(),
});

// ─── Analytics (rollup-backed, any window) ────────────────────────────────

/** Windows served entirely from the `edge_stat_*` rollups: cheap at every
 *  size, unlike the raw-scan procedures above whose 10k-row cap silently
 *  truncates long ranges. */
const analyticsRange = z.enum(["24h", "7d", "30d", "90d"]);

const analyticsInput = z
  .object({
    /** Restrict to one project's domains; omitted ⇒ all the org's domains. */
    projectId: zId("prj").optional(),
    /** Install-wide: EVERY host in the rollups, including the control-plane
     *  dashboard domain (which no org's domain list contains: the dominant
     *  traffic on a small install would otherwise be invisible everywhere).
     *  Install-admin only; overrides projectId. */
    installWide: z.boolean().optional(),
    range: analyticsRange.default("24h"),
    /** Narrow to ONE domain. Intersected with the caller's authorized host
     *  scope server-side: a host outside the scope yields empty data, never
     *  someone else's. */
    host: z.string().optional(),
    /** Custom window (epoch ms), overriding `range`. Both or neither. */
    from: z.number().int().positive().optional(),
    to: z.number().int().positive().optional(),
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: "from and to must be provided together",
  })
  .refine((v) => v.from === undefined || v.to === undefined || v.from < v.to, {
    message: "from must be before to",
  })
  .refine(
    (v) => v.from === undefined || v.to === undefined || v.to - v.from <= 400 * 24 * 60 * 60 * 1000,
    { message: "window must be 400 days or less" },
  );

const analyticsErrors = {
  FORBIDDEN: {
    status: 403,
    message: "Installation administrator access is required for install-wide analytics.",
  },
} as const;

/** One series bucket. Percentiles come from merged latency histograms; null
 *  when the bucket saw no requests (a p95 of nothing doesn't exist). */
const analyticsSeriesBucketSchema = z.object({
  /** ISO start of the bucket. */
  t: z.string(),
  requests: z.number(),
  botRequests: z.number(),
  s2xx: z.number(),
  s3xx: z.number(),
  s4xx: z.number(),
  s5xx: z.number(),
  sOther: z.number(),
  resBytes: z.number(),
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  p99: z.number().nullable(),
});

const analyticsSummarySchema = z.object({
  requests: z.number(),
  botRequests: z.number(),
  /** Sum of per-day distinct visitors. Deliberately NOT named "visitors":
   *  per-day counts cannot be combined into a window-distinct figure, so this
   *  is the honest upper bound and `peakDayVisitors` the exact lower bound. */
  visitorDays: z.number(),
  peakDayVisitors: z.number(),
  bytesOut: z.number(),
  avgLatencyMs: z.number().nullable(),
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  p99: z.number().nullable(),
  /** 4xx+5xx over total, 0..1. */
  errorRate: z.number(),
  hostCount: z.number(),
});

const analyticsFlagsSchema = z.object({
  /** Some day in the window is degraded: visitor-set eviction or a
   *  restart-reseed. Numbers are honest floors, not measurements. */
  approximate: z.boolean(),
  /** "rollup+live" when the current in-process accumulator was merged in. */
  source: z.enum(["rollup", "rollup+live"]),
  /** False ⇒ no GeoIP database configured: an empty countries list means
   *  "unknown", never "no visitors". */
  geoAvailable: z.boolean(),
  /** False ⇒ EDGE_LOG_SINK is unset, so Caddy was never told to stream access
   *  logs and NOTHING is being recorded. The page must say that rather than
   *  reporting an empty window, which implies a measurement that was taken. */
  sinkConfigured: z.boolean(),
  /** False while configured ⇒ the rollup loop refused to start (its day-row
   *  seed failed). Degraded, and previously silent. */
  collecting: z.boolean(),
});

/** The previous window of equal length, for the tiles' trend deltas. */
const analyticsPreviousSchema = z.object({
  requests: z.number(),
  visitorDays: z.number(),
  bytesOut: z.number(),
  p95: z.number().nullable(),
  errorRate: z.number(),
});

const analyticsOverviewResultSchema = z.object({
  series: z.array(analyticsSeriesBucketSchema),
  bucketSeconds: z.number(),
  summary: analyticsSummarySchema,
  previous: analyticsPreviousSchema,
  flags: analyticsFlagsSchema,
});

const analyticsTopEntrySchema = z.object({
  key: z.string(),
  count: z.number(),
});

const analyticsBreakdownsResultSchema = z.object({
  /** Requests per domain: the hosts the window's traffic actually hit. */
  hosts: z.array(analyticsTopEntrySchema),
  statuses: z.array(analyticsTopEntrySchema),
  paths: z.array(analyticsTopEntrySchema),
  referrers: z.array(analyticsTopEntrySchema),
  countries: z.array(analyticsTopEntrySchema),
  browsers: z.array(analyticsTopEntrySchema),
  oses: z.array(analyticsTopEntrySchema),
  deviceTypes: z.array(analyticsTopEntrySchema),
  /** Breakdowns are day-granular: the UTC days intersecting the range. For
   *  "24h" that is typically 2 calendar days: the UI labels this honestly
   *  instead of pretending sub-day precision. */
  breakdownDays: z.number(),
  flags: analyticsFlagsSchema,
});

// ─── Operational log plane (Phase 3) ──────────────────────────────────────

const eventCategory = z.enum(["cert", "upstream", "config", "other"]);
const eventLevel = z.enum(["debug", "info", "warn", "error"]);

const edgeEventLineSchema = z.object({
  id: z.string(),
  ts: z.string(),
  level: eventLevel,
  category: eventCategory,
  logger: z.string(),
  msg: z.string(),
  host: z.string().nullable(),
  domains: z.array(z.string()),
  upstream: z.string().nullable(),
  error: z.string().nullable(),
  raw: z.string(),
});

const edgeEventQueryInput = z.object({
  projectId: zId("prj").optional(),
  range: timeRange.default("1h"),
  categories: z.array(eventCategory).optional(),
  levels: z.array(eventLevel).optional(),
  hosts: z.array(z.string()).optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(1000).optional(),
});

const edgeEventTailInput = z.object({
  projectId: zId("prj").optional(),
  host: z.string().optional(),
});

const edgeEventQueryResultSchema = z.object({
  rows: z.array(edgeEventLineSchema),
  total: z.number(),
  /** False ⇒ EDGE_LOG_SINK is unset, so Caddy's default logger was never
   *  pointed at us and its TLS/ACME lifecycle goes to the container's stderr
   *  instead. An empty table then means "nothing is being collected", not
   *  "nothing happened" — and the difference is the one that leaves an
   *  operator staring at a blank pane while `docker logs` has the answer. */
  sinkConfigured: z.boolean(),
});

/**
 * One row of the access feed.
 *
 * Keyed by FILTER KEYS, because the projection on the server IS the column map
 * (see `access-table.ts`). `ts` is epoch milliseconds rather than an ISO
 * string: it is the cursor, the histogram's bucket key and the sort key, and
 * every one of those wants a number.
 *
 * `statusClass` and `suspicious` are DERIVED — compiled from SQL expressions,
 * not stored. They travel on the row rather than being recomputed per render
 * because they are filter keys, and the server's WHERE and the client's
 * evaluator only agree if the value itself makes the trip.
 */
const edgeAccessFeedRowSchema = z.object({
  id: z.string(),
  ts: z.number(),
  method: z.string(),
  status: z.number(),
  /** `2xx` | `3xx` | `4xx` | `5xx`. */
  statusClass: z.string(),
  host: z.string(),
  path: z.string(),
  clientIp: z.string(),
  country: z.string().nullable(),
  upstream: z.string().nullable(),
  cache: z.string().nullable(),
  latencyMs: z.number(),
  userAgent: z.string(),
  referer: z.string(),
  /** `yes` when the path matches a scanner-probe rule. See edge-logs/threat.ts. */
  suspicious: z.string(),
  tlsVersion: z.string().nullable(),
  tlsCipher: z.string().nullable(),
  reqBytes: z.number(),
  resBytes: z.number(),
  requestId: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
});

export type EdgeAccessFeedRow = z.infer<typeof edgeAccessFeedRowSchema>;

const edgeAccessFeedInput = feedInput.extend({
  /** Narrow the host scope to one project's domains. Absent = the whole org. */
  projectId: zId("prj").optional(),
});

/** The feed, plus whether this install is recording traffic at all. */
const edgeAccessFeedOutput = feedOutput(edgeAccessFeedRowSchema).extend({
  /** False ⇒ EDGE_LOG_SINK is unset: Caddy's access log never reached us. */
  sinkConfigured: z.boolean(),
  /** False ⇒ requests arrive, but only into the ring this feed cannot read. */
  persisting: z.boolean(),
});

/**
 * One row of the event feed.
 *
 * Keyed by FILTER KEYS, because the projection on the server IS the column map
 * (see `events-table.ts`). One identity space runs from the URL parameter
 * through the column definition to the WHERE clause, so nothing translates.
 *
 * `ts` is epoch milliseconds rather than an ISO string: it is the cursor, the
 * histogram's bucket key and the sort key, and every one of those wants a
 * number.
 *
 * `level` and `category` are strings, not the enums above. Both columns are
 * `text` written by Caddy's own logger, and a row carrying something outside
 * the vocabulary is a row to report, not one to relabel. The FILTER is held to
 * the declared set; see `edgeEventFilterSpecs`.
 *
 * `hosts` is what the row is attributable to AND the caller owns — the key the
 * host filter is over. `domains` is the raw batch list, narrowed to the same
 * owned set.
 */
const edgeEventFeedRowSchema = z.object({
  id: z.string(),
  ts: z.number(),
  level: z.string(),
  category: z.string(),
  logger: z.string(),
  msg: z.string(),
  host: z.string().nullable(),
  hosts: z.array(z.string()),
  domains: z.array(z.string()),
  upstream: z.string().nullable(),
  error: z.string().nullable(),
  raw: z.string(),
});

export type EdgeEventFeedRow = z.infer<typeof edgeEventFeedRowSchema>;

const edgeEventFeedInput = feedInput.extend({
  /** Narrow the host scope to one project's domains. Absent = the whole org. */
  projectId: zId("prj").optional(),
});

/**
 * The feed, plus whether this install is collecting events at all.
 *
 * Those two booleans are the difference between "nothing happened in this
 * window" and "nothing has ever been recorded", which an empty table cannot
 * express on its own — and which no time range the reader tries will fix.
 */
const edgeEventFeedOutput = feedOutput(edgeEventFeedRowSchema).extend({
  /** False ⇒ EDGE_LOG_SINK is unset: Caddy's default logger never reached us. */
  sinkConfigured: z.boolean(),
  /** False ⇒ events arrive, but only into the ring this feed cannot read. */
  persisting: z.boolean(),
});

export const edgeLogsContract = {
  /**
   * The Access logs pane. Filters, facets, histogram and cursor paging over
   * `edge_log`, from one declaration — see `./access-feed.ts`.
   */
  feed: oc
    .meta({ path: "/edge-logs/feed", tag, method: "POST" })
    .input(edgeAccessFeedInput)
    .output(edgeAccessFeedOutput),

  /**
   * The pre-shell range query: ring-backed, so it still answers when
   * persistence is off, and it carries the per-host percentile summary the
   * project metrics overview reads. The Access logs pane no longer calls it.
   */
  query: oc
    .meta({ path: "/edge-logs", tag, method: "GET" })
    .input(edgeLogQueryInput)
    .output(edgeLogQueryResultSchema),

  tail: oc
    .meta({ path: "/edge-logs/tail", tag, method: "GET" })
    .input(edgeLogTailInput)
    .output(eventIterator(edgeLogLineSchema)),

  // Per-host traffic stats for one project's routes, mapped to the owning
  // resource. Powers the graph's live traffic edges and the stack panel's
  // Traffic tab. Same org host-scope guard as `query`.
  routeStats: oc
    .meta({ path: "/edge-logs/route-stats", tag, method: "GET" })
    .input(routeStatsInput)
    .output(z.array(routeStatSchema)),

  // Bucketed request-rate + per-bucket p95 across all of one project's public
  // hosts: the request half of the project metrics overview. Same org
  // host-scope guard as `query`/`routeStats`.
  requestSeries: oc
    .meta({ path: "/edge-logs/request-series", tag, method: "GET" })
    .input(requestSeriesInput)
    .output(requestSeriesResultSchema),

  // Traffic analytics from the ingest-time rollups: any window, exact counts,
  // no raw-row scans. Same org host-scope guard as everything above.
  analytics: {
    overview: oc
      .errors(analyticsErrors)
      .meta({ path: "/edge-logs/analytics/overview", tag, method: "GET" })
      .input(analyticsInput)
      .output(analyticsOverviewResultSchema),

    breakdowns: oc
      .errors(analyticsErrors)
      .meta({ path: "/edge-logs/analytics/breakdowns", tag, method: "GET" })
      .input(analyticsInput)
      .output(analyticsBreakdownsResultSchema),
  },

  // Operational events (cert/ACME, upstream errors): the second Caddy log
  // plane. Same org host-scope guard as access logs.
  events: {
    /**
     * The Events pane. Filters, facets, histogram and cursor paging over
     * `edge_event`, from one declaration — see `./events-feed.ts`.
     */
    feed: oc
      .meta({ path: "/edge-logs/events/feed", tag, method: "POST" })
      .input(edgeEventFeedInput)
      .output(edgeEventFeedOutput),

    /**
     * The pre-shell range query: ring-backed, so it still answers when
     * persistence is off. Nothing in the web app calls it since the Events
     * pane moved onto `feed`; it stays because it is a published REST path and
     * `tail` beside it backs `otd edge events --follow`. Retiring it is a
     * deliberate API break, not a cleanup — see od-fqhk.
     */
    query: oc
      .meta({ path: "/edge-logs/events", tag, method: "GET" })
      .input(edgeEventQueryInput)
      .output(edgeEventQueryResultSchema),

    tail: oc
      .meta({ path: "/edge-logs/events/tail", tag, method: "GET" })
      .input(edgeEventTailInput)
      .output(eventIterator(edgeEventLineSchema)),
  },
};
