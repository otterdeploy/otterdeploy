import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

/**
 * Traffic-analytics rollups, aggregated AT INGEST from Caddy access logs.
 *
 * WHY ROLLUPS AND NOT QUERIES OVER `edge_log`: the raw table is scanned with a
 * 10k-row cap and swept on a short retention (7 days by default), so any
 * analytics window past an hour silently under-reports and anything past the
 * retention is unanswerable. These two tables are written by the in-process
 * accumulator in packages/api/src/edge-logs/aggregate.ts and give the
 * Analytics surface exact counts over months at ~1440 rows/host/day worst
 * case (a minute row exists only for a minute that had traffic).
 *
 * Keyed by `host` rather than org/project on purpose: ingest doesn't know
 * which org a domain belongs to, and domains move between orgs. Readers
 * resolve the caller's hosts and aggregate across them, exactly like
 * `edge_threat_ip` and the raw-log path do.
 *
 * Write semantics differ BY DESIGN between the two granularities:
 * - `edge_stat_minute` rows are closed-minute DELTAS, inserted once with
 *   ON CONFLICT DO NOTHING (idempotent across restarts and backfill overlap).
 * - `edge_stat_day` rows are RUNNING TOTALS for the day, upserted full-set
 *   with last-write-wins. Safe because exactly one in-process accumulator
 *   owns a day at a time; if edge-log sinks ever fan out to multiple
 *   processes, the day flush must become a delta-add upsert instead.
 */

/** Upper bounds (ms) of the latency histogram buckets. A request lands in the
 *  first bucket whose bound is >= its latency; the 13th slot is overflow.
 *  Fixed forever once rows exist: changing bounds silently re-labels history. */
export const LATENCY_BUCKET_BOUNDS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
] as const;
export const LATENCY_BUCKET_COUNT = LATENCY_BUCKET_BOUNDS_MS.length + 1;

/** Columns identical across both granularities: status classes, byte
 *  counters, and the mergeable latency histogram. A factory (not a shared
 *  const) so each table gets fresh builder instances.
 *
 *  bigint bytes: an int4 byte counter caps at ~2 GB/min (~286 Mbps), which
 *  routine video/download traffic exceeds; the busiest hosts must not be the
 *  ones whose analytics break. */
function trafficStatColumns() {
  return {
    s2xx: integer("s2xx").notNull(),
    s3xx: integer("s3xx").notNull(),
    s4xx: integer("s4xx").notNull(),
    s5xx: integer("s5xx").notNull(),
    /** Status 0 (client gone before response) / 1xx / out-of-range. Kept apart
     *  so the four class shares still add up in the UI. */
    sOther: integer("s_other").notNull(),
    reqBytes: bigint("req_bytes", { mode: "number" }).notNull(),
    resBytes: bigint("res_bytes", { mode: "number" }).notNull(),
    /** LATENCY_BUCKET_COUNT counters over LATENCY_BUCKET_BOUNDS_MS + overflow.
     *  Histograms merge across any window, so percentiles never need raw rows. */
    latencyBuckets: integer("latency_buckets").array().notNull(),
    latencySumMs: bigint("latency_sum_ms", { mode: "number" }).notNull(),
  };
}

export const edgeStatMinute = pgTable(
  "edge_stat_minute",
  {
    /** Lowercased request host. */
    host: text("host").notNull(),
    /** Epoch minutes UTC: floor(unix ms / 60_000). */
    minute: integer("minute").notNull(),
    /** Total requests, bots included. */
    requests: integer("requests").notNull(),
    /** Subset of `requests` classified as bots/CLI tools by user agent. */
    botRequests: integer("bot_requests").notNull(),
    ...trafficStatColumns(),
    latencyMaxMs: integer("latency_max_ms").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.host, t.minute] }),
    // Retention prune deletes by minute alone.
    index("edge_stat_minute_minute_idx").on(t.minute),
  ],
);

export const edgeStatDay = pgTable(
  "edge_stat_day",
  {
    /** Lowercased request host. */
    host: text("host").notNull(),
    /** Zero-padded UTC day "YYYYMMDD": lexical order == chronological order,
     *  so range scans are plain text comparisons (same trick as the raw
     *  table's partition names). */
    day: text("day").notNull(),
    requests: bigint("requests", { mode: "number" }).notNull(),
    botRequests: bigint("bot_requests", { mode: "number" }).notNull(),
    ...trafficStatColumns(),
    /** Exact status code → count ({"200": 4210, "404": 17}). Classes above are
     *  derived at write time so readers never re-bucket. */
    statuses: jsonb("statuses").$type<Record<string, number>>().notNull(),
    /** Distinct visitors this UTC day (salted 64-bit hash dedup at ingest,
     *  bots excluded; no per-visitor row exists anywhere). Per-day counts are
     *  NOT combinable into a window-distinct figure: readers expose the sum as
     *  "visitor days" and the max as a lower bound, never as "visitors". */
    visitors: integer("visitors").notNull(),
    /** True when this day's numbers are known-degraded: the visitor set hit
     *  its memory cap (undercounting) or the accumulator was re-seeded after a
     *  restart (possible double-count of returning visitors). */
    approximate: boolean("approximate").notNull(),
    /** ISO-3166-1 alpha-2 → count. Only ever 2-letter uppercase keys, so a
     *  bookkeeping key can never skew the total. */
    countries: jsonb("countries").$type<Record<string, number>>().notNull(),
    /** Normalized path → count, capped per day with an "__other" overflow
     *  bucket. Query strings are stripped and id-ish segments collapsed at
     *  ingest, so no token or session id ever becomes a persisted key. */
    paths: jsonb("paths").$type<Record<string, number>>().notNull(),
    /** Referrer host → count (self-referrals dropped), capped + "__other". */
    referrers: jsonb("referrers").$type<Record<string, number>>().notNull(),
    browsers: jsonb("browsers").$type<Record<string, number>>().notNull(),
    oses: jsonb("oses").$type<Record<string, number>>().notNull(),
    deviceTypes: jsonb("device_types").$type<Record<string, number>>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.host, t.day] }),
    // Retention prune + range scans delete/read by day alone.
    index("edge_stat_day_day_idx").on(t.day),
  ],
);
