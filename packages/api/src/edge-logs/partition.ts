/**
 * Edge-log table partitioning (edge-logs Phase 2, time-partitioned).
 *
 * `edge_log` is RANGE-partitioned by `ts` into daily child tables. That turns
 * retention into a metadata-only `DROP TABLE old_partition` (instant, no dead
 * tuples) instead of a row-by-row DELETE that bloats the heap and churns
 * indexes under high write volume. A BRIN index on `ts` keeps time-range scans
 * cheap for a fraction of a btree's size.
 *
 * Drizzle's schema DSL can't express PARTITION BY, so the table is owned here
 * via idempotent DDL run at startup (and is removed from the schema barrel so
 * drizzle-kit doesn't try to manage a non-partitioned version). Everything is
 * `CREATE … IF NOT EXISTS` / `DROP … IF EXISTS`, so it's safe to run repeatedly
 * and across `--hot` reloads.
 */

import { db } from "@otterdeploy/db";
import { Result } from "better-result";
import { sql } from "drizzle-orm";
import { log } from "evlog";

/**
 * UNLOGGED partitions skip the WAL for a large write-throughput win — a fit for
 * disposable, ring-backed telemetry. The catch: Postgres TRUNCATES unlogged
 * tables on crash recovery (a *clean* restart is fine), so a crash drops ALL
 * persisted history, not just recent rows. Off by default since Phase 2's whole
 * point is surviving restarts; flip to `true` to trade that durability for
 * write speed.
 */
const UNLOGGED = false;

/** How many days of partitions to pre-create ahead of ingest. */
const AHEAD_DAYS = 2;

const TABLE_KW = UNLOGGED ? "UNLOGGED TABLE" : "TABLE";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function partitionName(d: Date): string {
  return `edge_log_${isoDay(d).replace(/-/g, "_")}`;
}
function addDaysUtc(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Run one DDL statement, logging (not throwing) on failure. */
async function exec(label: string, ddl: string): Promise<void> {
  const res = await Result.tryPromise({
    try: () => db.execute(sql.raw(ddl)),
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    log.error({
      edgeLog: { partition: label },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
  }
}

/**
 * Create the partitioned `edge_log` table (+ BRIN/host indexes, default and
 * rolling daily partitions) if absent. Drops any pre-existing NON-partitioned
 * `edge_log` first — that data is disposable 7-day telemetry and the ring still
 * holds the live window — so a table left behind by an earlier drizzle-kit push
 * is converted cleanly.
 */
export async function ensureEdgeLogTable(): Promise<void> {
  await exec(
    "drop-legacy",
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = 'edge_log' AND n.nspname = 'public' AND c.relkind <> 'p'
       ) THEN EXECUTE 'DROP TABLE edge_log'; END IF;
     END $$;`,
  );

  await exec(
    "create-parent",
    `CREATE TABLE IF NOT EXISTS edge_log (
       id bigserial,
       ts timestamptz NOT NULL,
       method text NOT NULL,
       host text NOT NULL,
       path text NOT NULL,
       status integer NOT NULL,
       latency_ms integer NOT NULL,
       client_ip text NOT NULL,
       country text,
       user_agent text NOT NULL,
       referer text NOT NULL,
       tls_version text,
       tls_cipher text,
       upstream text,
       cache text,
       req_bytes integer NOT NULL,
       res_bytes integer NOT NULL,
       request_id text,
       headers jsonb NOT NULL DEFAULT '{}'::jsonb,
       PRIMARY KEY (id, ts)
     ) PARTITION BY RANGE (ts);`,
  );

  // BRIN on ts (append-only, time-ordered → tiny + ideal). (host, ts) keeps the
  // per-host histogram/percentile queries fast. Indexes on the parent propagate
  // to every partition.
  await exec(
    "index-brin",
    `CREATE INDEX IF NOT EXISTS edge_log_ts_brin ON edge_log USING brin (ts);`,
  );
  await exec(
    "index-host-ts",
    `CREATE INDEX IF NOT EXISTS edge_log_host_ts_idx ON edge_log (host, ts);`,
  );

  // Default partition: any row outside the pre-created daily ranges still
  // inserts (a missing partition would otherwise fail the insert). Stays
  // ~empty as long as ensurePartitions() runs ahead of ingest.
  await exec(
    "default-partition",
    `CREATE ${TABLE_KW} IF NOT EXISTS edge_log_default PARTITION OF edge_log DEFAULT;`,
  );

  await ensurePartitions();
}

/** Ensure daily partitions exist for [yesterday … today+AHEAD_DAYS]. */
export async function ensurePartitions(): Promise<void> {
  const today = new Date();
  // From -1 to cover the clock-skew window right around a UTC day boundary.
  for (let i = -1; i <= AHEAD_DAYS; i++) {
    const day = addDaysUtc(today, i);
    const from = `${isoDay(day)} 00:00:00+00`;
    const to = `${isoDay(addDaysUtc(day, 1))} 00:00:00+00`;
    await exec(
      "ensure-partition",
      `CREATE ${TABLE_KW} IF NOT EXISTS ${partitionName(day)}
         PARTITION OF edge_log
         FOR VALUES FROM ('${from}') TO ('${to}');`,
    );
  }
}

/**
 * Drop daily partitions whose day is entirely older than the retention window.
 * Metadata-only — no heap scan, no dead tuples. The default partition is never
 * dropped (it should be near-empty; stragglers there age out naturally as it's
 * tiny).
 */
export async function dropOldPartitions(retentionDays: number): Promise<void> {
  const res = await Result.tryPromise({
    try: () =>
      db.execute(
        sql.raw(
          `SELECT c.relname AS name
           FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
           JOIN pg_class p ON p.oid = i.inhparent
           WHERE p.relname = 'edge_log'
             AND c.relname ~ '^edge_log_[0-9]{4}_[0-9]{2}_[0-9]{2}$';`,
        ),
      ),
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    log.error({
      edgeLog: { partition: "list-failed" },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
    return;
  }

  // bun-sql returns rows as an array; tolerate a { rows } wrapper too.
  const value = res.value;
  const rows = (
    Array.isArray(value) ? value : ((value as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ name: string }>;

  // Zero-padded YYYY_MM_DD compares correctly lexicographically.
  const cutoffKey = isoDay(addDaysUtc(new Date(), -retentionDays)).replace(/-/g, "_");
  for (const { name } of rows) {
    const dayKey = name.slice("edge_log_".length);
    if (dayKey < cutoffKey) {
      await exec("drop-partition", `DROP TABLE IF EXISTS ${name};`);
    }
  }
}
