/**
 * `analytics_event` partitioning (web analytics, tracker plane).
 *
 * Same shape as edge-logs/partition.ts: the raw event stream is
 * RANGE-partitioned by `ts` into daily child tables so retention is a
 * metadata-only `DROP TABLE` and a BRIN index on `ts` keeps range scans cheap.
 * Drizzle's DSL can't express PARTITION BY, so the table is owned here via
 * idempotent DDL run at startup; the typed definition in
 * packages/db/src/schema/analytics-event.ts must be kept in sync by hand.
 */

import { db } from "@otterdeploy/db";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { sql } from "drizzle-orm";
import { log } from "evlog";
import * as z from "zod";

const TABLE = "analytics_event";
/** How many days of partitions to pre-create ahead of ingest. */
const AHEAD_DAYS = 2;

function todayUtc(): Temporal.PlainDate {
  return Temporal.Now.plainDateISO("UTC");
}
function partitionName(day: Temporal.PlainDate): string {
  return `${TABLE}_${day.toString().replace(/-/g, "_")}`;
}

/** Run one DDL statement, logging (not throwing) on failure. */
async function exec(label: string, ddl: string): Promise<void> {
  const res = await Result.tryPromise({
    try: () => db.execute(sql.raw(ddl)),
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    log.error({
      analytics: { partition: label },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
  }
}

/**
 * Create the partitioned `analytics_event` table (+ indexes, default and
 * rolling daily partitions) if absent. Column list mirrors
 * packages/db/src/schema/analytics-event.ts.
 */
export async function ensureAnalyticsEventTable(): Promise<void> {
  await exec(
    "drop-legacy",
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = '${TABLE}' AND n.nspname = 'public' AND c.relkind <> 'p'
       ) THEN EXECUTE 'DROP TABLE ${TABLE}'; END IF;
     END $$;`,
  );

  await exec(
    "create-parent",
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       id text NOT NULL,
       ts timestamptz NOT NULL,
       site_id text NOT NULL,
       session_id text NOT NULL,
       visitor_id text NOT NULL,
       kind text NOT NULL,
       name text,
       props jsonb,
       path text NOT NULL,
       host text NOT NULL,
       referrer_host text,
       utm_source text,
       utm_medium text,
       utm_campaign text,
       utm_term text,
       utm_content text,
       country text,
       browser text NOT NULL,
       os text NOT NULL,
       device text NOT NULL,
       screen_w smallint,
       language text,
       PRIMARY KEY (id, ts)
     ) PARTITION BY RANGE (ts);`,
  );

  await exec(
    "index-brin",
    `CREATE INDEX IF NOT EXISTS ${TABLE}_ts_brin ON ${TABLE} USING brin (ts);`,
  );
  await exec(
    "index-site-ts",
    `CREATE INDEX IF NOT EXISTS ${TABLE}_site_ts_idx ON ${TABLE} (site_id, ts);`,
  );
  await exec(
    "index-site-session",
    `CREATE INDEX IF NOT EXISTS ${TABLE}_site_session_idx ON ${TABLE} (site_id, session_id);`,
  );
  await exec(
    "default-partition",
    `CREATE TABLE IF NOT EXISTS ${TABLE}_default PARTITION OF ${TABLE} DEFAULT;`,
  );

  await ensureAnalyticsPartitions();
}

/** Ensure daily partitions exist for [yesterday … today+AHEAD_DAYS]. */
export async function ensureAnalyticsPartitions(): Promise<void> {
  const today = todayUtc();
  for (let i = -1; i <= AHEAD_DAYS; i++) {
    const day = today.add({ days: i });
    const from = `${day.toString()} 00:00:00+00`;
    const to = `${day.add({ days: 1 }).toString()} 00:00:00+00`;
    await exec(
      "ensure-partition",
      `CREATE TABLE IF NOT EXISTS ${partitionName(day)}
         PARTITION OF ${TABLE}
         FOR VALUES FROM ('${from}') TO ('${to}');`,
    );
  }
}

const partitionRows = z.array(z.object({ name: z.string() }));

/**
 * Drop daily partitions entirely older than the retention window. The default
 * partition is never dropped.
 */
export async function dropOldAnalyticsPartitions(retentionDays: number): Promise<void> {
  const res = await Result.tryPromise({
    try: () =>
      db.execute(
        sql.raw(
          `SELECT c.relname AS name
           FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
           JOIN pg_class p ON p.oid = i.inhparent
           WHERE p.relname = '${TABLE}'
             AND c.relname ~ '^${TABLE}_[0-9]{4}_[0-9]{2}_[0-9]{2}$';`,
        ),
      ),
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    log.error({
      analytics: { partition: "list-failed" },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
    return;
  }

  // The driver result is an untyped boundary: schema-parse, never cast.
  const value: unknown = res.value;
  const rows = partitionRows.parse(
    Array.isArray(value)
      ? value
      : typeof value === "object" && value !== null && "rows" in value && Array.isArray(value.rows)
        ? value.rows
        : [],
  );

  // Zero-padded YYYY_MM_DD compares correctly lexicographically.
  const cutoffKey = todayUtc().subtract({ days: retentionDays }).toString().replace(/-/g, "_");
  for (const { name } of rows) {
    const dayKey = name.slice(`${TABLE}_`.length);
    if (dayKey < cutoffKey) {
      await exec("drop-partition", `DROP TABLE IF EXISTS ${name};`);
    }
  }
}
