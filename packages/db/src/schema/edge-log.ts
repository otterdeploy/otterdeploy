import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Persisted Caddy edge access logs (edge-logs Phase 2). High write volume, so
 * the table is RANGE-partitioned by `ts` into daily child tables: retention is
 * a metadata-only `DROP TABLE old_partition` (instant, no heap bloat) instead
 * of a row-by-row DELETE, and a BRIN index on `ts` keeps time-range scans cheap
 * at a fraction of a btree's size. The live tail still runs off the in-memory
 * ring; this table backs the 24h/7d ranges and survives restarts.
 *
 * IMPORTANT: this table is NOT managed by drizzle-kit (it's removed from the
 * schema barrel). drizzle-kit can't express PARTITION BY, and a partitioned
 * table's PK must include the partition key — hence the composite (id, ts). The
 * real DDL — partitioned parent, daily partitions, BRIN index, DROP-based
 * retention — lives in packages/api/src/edge-logs/partition.ts and runs at
 * startup. This definition exists only for typed queries/inserts; keep it in
 * sync with that DDL.
 */
export const edgeLog = pgTable(
  "edge_log",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    method: text("method").notNull(),
    host: text("host").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    clientIp: text("client_ip").notNull(),
    country: text("country"),
    userAgent: text("user_agent").notNull(),
    referer: text("referer").notNull(),
    tlsVersion: text("tls_version"),
    tlsCipher: text("tls_cipher"),
    upstream: text("upstream"),
    cache: text("cache"),
    reqBytes: integer("req_bytes").notNull(),
    resBytes: integer("res_bytes").notNull(),
    requestId: text("request_id"),
    headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.ts] }),
    index("edge_log_host_ts_idx").on(t.host, t.ts),
    index("edge_log_ts_brin").using("brin", t.ts),
  ],
);
