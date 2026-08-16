/**
 * DB half of the analytics accumulator: the minute insert, the day upsert,
 * the restart seed, and retention pruning. Split from ./aggregate so the
 * in-memory fold stays a pure, testable module; everything here takes its
 * rows explicitly and owns no state.
 */

import { db } from "@otterdeploy/db";
import {
  edgeStatDay,
  edgeStatMinute,
  LATENCY_BUCKET_COUNT,
} from "@otterdeploy/db/schema/edge-stat";
import { Result } from "better-result";
import { inArray, lt, sql } from "drizzle-orm";
import { log } from "evlog";

import type { DayAcc, MinuteAcc } from "./analytics-fold";

import { zeroHistogram } from "./analytics-fold";
import { dayKey, epochMinute } from "./analytics-normalize";

export const EDGE_STAT_MINUTE_RETENTION_DAYS = 90;
export const EDGE_STAT_DAY_RETENTION_DAYS = 400;

/** Closed-minute deltas: insert-once, conflicts dropped (idempotent across
 *  restarts and backfill overlap). */
export async function flushMinuteRows(closed: MinuteAcc[]): Promise<void> {
  if (closed.length === 0) return;
  const res = await Result.tryPromise({
    try: () => db.insert(edgeStatMinute).values(closed).onConflictDoNothing(),
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    // Rows are lost rather than retried: a retry queue on a failing DB would
    // grow without bound on the ingest path. The day rollup still carries the
    // traffic, so only series resolution suffers.
    log.error({
      edgeLog: { analytics: "minute-flush-failed", count: closed.length },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
  }
}

/** Day running totals: full-set last-write-wins upsert. A partial set would
 *  freeze the omitted columns at their creation values. Returns success so
 *  the caller only drops settled accs after a real write. */
export async function flushDayRows(rows: DayAcc[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const res = await Result.tryPromise({
    try: () =>
      db
        .insert(edgeStatDay)
        .values(rows)
        .onConflictDoUpdate({
          target: [edgeStatDay.host, edgeStatDay.day],
          set: {
            requests: sql`excluded.requests`,
            botRequests: sql`excluded.bot_requests`,
            reqBytes: sql`excluded.req_bytes`,
            resBytes: sql`excluded.res_bytes`,
            s2xx: sql`excluded.s2xx`,
            s3xx: sql`excluded.s3xx`,
            s4xx: sql`excluded.s4xx`,
            s5xx: sql`excluded.s5xx`,
            sOther: sql`excluded.s_other`,
            statuses: sql`excluded.statuses`,
            visitors: sql`excluded.visitors`,
            approximate: sql`excluded.approximate`,
            countries: sql`excluded.countries`,
            paths: sql`excluded.paths`,
            referrers: sql`excluded.referrers`,
            browsers: sql`excluded.browsers`,
            oses: sql`excluded.oses`,
            deviceTypes: sql`excluded.device_types`,
            latencyBuckets: sql`excluded.latency_buckets`,
            latencySumMs: sql`excluded.latency_sum_ms`,
          },
        }),
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    log.error({
      edgeLog: { analytics: "day-flush-failed", count: rows.length },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
    return false;
  }
  return true;
}

/** Existing day rows for the given keys, as accumulators marked approximate
 *  (the visitor hash set cannot be reconstructed, so returning visitors may
 *  double-count from the seed point on). */
export async function seedDayRows(days: string[]): Promise<DayAcc[]> {
  const rows = await db.select().from(edgeStatDay).where(inArray(edgeStatDay.day, days));
  return rows.map((row) => ({
    ...row,
    approximate: true,
    latencyBuckets:
      row.latencyBuckets.length === LATENCY_BUCKET_COUNT ? row.latencyBuckets : zeroHistogram(),
  }));
}

export async function pruneAnalyticsRollups(): Promise<void> {
  const minuteCutoff = epochMinute(
    Date.now() - EDGE_STAT_MINUTE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const dayCutoff = dayKey(Date.now() - EDGE_STAT_DAY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const res = await Result.tryPromise({
    try: async () => {
      await db.delete(edgeStatMinute).where(lt(edgeStatMinute.minute, minuteCutoff));
      await db.delete(edgeStatDay).where(lt(edgeStatDay.day, dayCutoff));
    },
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    log.error({
      edgeLog: { analytics: "prune-failed" },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
  }
}
