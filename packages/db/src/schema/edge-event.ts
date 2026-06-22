import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Persisted Caddy operational-log events (edge-logs Phase 3) — cert/ACME
 * lifecycle, reverse_proxy upstream errors, and other warn/error operational
 * lines. Unlike the high-volume access log (`edge_log`, partitioned + managed
 * by raw DDL), events are SPARSE (the live ring caps at ~5k), so a plain
 * drizzle-managed table with DELETE-based retention is plenty — no
 * partitioning. The live tail still runs off the in-memory ring; this backs
 * the Events tab across restarts.
 */
export const edgeEvent = pgTable(
  "edge_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    level: text("level").notNull(),
    category: text("category").notNull(),
    logger: text("logger").notNull(),
    msg: text("msg").notNull(),
    host: text("host"),
    domains: jsonb("domains").$type<string[]>().notNull().default([]),
    upstream: text("upstream"),
    error: text("error"),
    raw: text("raw").notNull(),
  },
  (table) => [index("edge_event_ts_idx").on(table.ts)],
);
