/**
 * Bucket plumbing for the analytics readers: the internal accumulation shape,
 * histogram math, and the SQL loaders that group minute rows server-side so
 * the rows crossing the wire scale with the window's bucket count, never with
 * traffic volume.
 */

import { db } from "@otterdeploy/db";
import {
  LATENCY_BUCKET_BOUNDS_MS,
  LATENCY_BUCKET_COUNT,
} from "@otterdeploy/db/schema/edge-stat";
import { sql } from "drizzle-orm";
import * as z from "zod";

import type { DayAcc, MinuteAcc } from "./analytics-fold";

import { zeroHistogram } from "./analytics-fold";

/** Nominal ceiling for the overflow bucket, for interpolation only: a p99
 *  landing there reads "≥5000", clamped here rather than invented. */
const OVERFLOW_CEILING_MS = 10_000;

/**
 * Percentile from a merged latency histogram via linear interpolation inside
 * the containing bucket. Exact at the bucket bounds, honest in between; null
 * for an empty histogram (a percentile of nothing does not exist).
 */
export function percentileFromBuckets(buckets: readonly number[], q: number): number | null {
  let total = 0;
  for (const c of buckets) total += c;
  if (total === 0) return null;
  const rank = q * total;
  let cumulative = 0;
  for (let i = 0; i < buckets.length; i++) {
    const count = buckets[i] ?? 0;
    if (count === 0) continue;
    if (cumulative + count >= rank) {
      const lower = i === 0 ? 0 : (LATENCY_BUCKET_BOUNDS_MS[i - 1] ?? 0);
      const upper =
        i < LATENCY_BUCKET_BOUNDS_MS.length
          ? (LATENCY_BUCKET_BOUNDS_MS[i] ?? OVERFLOW_CEILING_MS)
          : OVERFLOW_CEILING_MS;
      const within = (rank - cumulative) / count;
      return Math.round(lower + (upper - lower) * within);
    }
    cumulative += count;
  }
  return null;
}

export function emptyHistogram(): number[] {
  return zeroHistogram();
}

export function addHistogram(into: number[], from: readonly number[]): void {
  for (let i = 0; i < into.length; i++) into[i] = (into[i] ?? 0) + (from[i] ?? 0);
}

export interface InternalBucket {
  startMs: number;
  requests: number;
  botRequests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  sOther: number;
  resBytes: number;
  latencySumMs: number;
  histogram: number[];
}

export function newInternalBucket(startMs: number): InternalBucket {
  return {
    startMs,
    requests: 0,
    botRequests: 0,
    s2xx: 0,
    s3xx: 0,
    s4xx: 0,
    s5xx: 0,
    sOther: 0,
    resBytes: 0,
    latencySumMs: 0,
    histogram: emptyHistogram(),
  };
}

/** Fold scalar counters + histogram from any acc-shaped source. */
export function addIntoBucket(
  b: InternalBucket,
  src: Pick<
    InternalBucket,
    "requests" | "botRequests" | "s2xx" | "s3xx" | "s4xx" | "s5xx" | "sOther" | "latencySumMs"
  > & { resBytes: number; latencyBuckets?: readonly number[]; histogram?: readonly number[] },
): void {
  b.requests += src.requests;
  b.botRequests += src.botRequests;
  b.s2xx += src.s2xx;
  b.s3xx += src.s3xx;
  b.s4xx += src.s4xx;
  b.s5xx += src.s5xx;
  b.sOther += src.sOther;
  b.resBytes += src.resBytes;
  b.latencySumMs += src.latencySumMs;
  addHistogram(b.histogram, src.latencyBuckets ?? src.histogram ?? []);
}

/** bun-sql's `db.execute` returns a plain row array; tolerate a `{ rows }`
 *  wrapper like partition.ts does, without asserting either shape. */
function executeRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object" && "rows" in value) {
    const rows = value.rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

const minuteAggRow = z.object({
  bucket: z.coerce.number(),
  requests: z.coerce.number(),
  bot_requests: z.coerce.number(),
  s2xx: z.coerce.number(),
  s3xx: z.coerce.number(),
  s4xx: z.coerce.number(),
  s5xx: z.coerce.number(),
  s_other: z.coerce.number(),
  res_bytes: z.coerce.number(),
  latency_sum_ms: z.coerce.number(),
});

const histogramAggRow = z.object({
  bucket: z.coerce.number(),
  idx: z.coerce.number(),
  c: z.coerce.number(),
});

/**
 * Minute rows for `hosts` since `fromMinute`, grouped SQL-side into
 * `stepMinutes` buckets, histograms merged via unnest-with-ordinality
 * (bucketCount × 13 tiny rows). `stepMinutes` is a compile-time constant from
 * the range table, so `sql.raw` is parameter-injection-safe here.
 */
export async function loadMinuteBuckets(
  hosts: string[] | null,
  fromMinute: number,
  stepMinutes: number,
): Promise<Map<number, InternalBucket>> {
  const buckets = new Map<number, InternalBucket>();
  if (hosts !== null && hosts.length === 0) return buckets;
  const step = sql.raw(String(stepMinutes));
  // A bare JS array in a sql`` template renders as `(($1, $2, …))` — a record,
  // not an array — and Postgres rejects `= ANY(record)`. Join into an IN list.
  // `hosts: null` = install-wide: no host predicate.
  const hostPredicate =
    hosts === null
      ? sql`true`
      : sql`host IN (${sql.join(
          hosts.map((h) => sql`${h}`),
          sql`, `,
        )})`;

  const scalarRes = await db.execute(sql`
    SELECT (floor(minute / ${step})::int * ${step}) AS bucket,
      sum(requests)::float8 AS requests,
      sum(bot_requests)::float8 AS bot_requests,
      sum(s2xx)::float8 AS s2xx, sum(s3xx)::float8 AS s3xx,
      sum(s4xx)::float8 AS s4xx, sum(s5xx)::float8 AS s5xx,
      sum(s_other)::float8 AS s_other,
      sum(res_bytes)::float8 AS res_bytes,
      sum(latency_sum_ms)::float8 AS latency_sum_ms
    FROM edge_stat_minute
    WHERE ${hostPredicate} AND minute >= ${fromMinute}
    GROUP BY 1
  `);
  for (const raw of executeRows(scalarRes)) {
    const row = minuteAggRow.safeParse(raw);
    if (!row.success) continue;
    const r = row.data;
    const startMs = r.bucket * 60_000;
    const b = newInternalBucket(startMs);
    b.requests = r.requests;
    b.botRequests = r.bot_requests;
    b.s2xx = r.s2xx;
    b.s3xx = r.s3xx;
    b.s4xx = r.s4xx;
    b.s5xx = r.s5xx;
    b.sOther = r.s_other;
    b.resBytes = r.res_bytes;
    b.latencySumMs = r.latency_sum_ms;
    buckets.set(startMs, b);
  }

  const histRes = await db.execute(sql`
    SELECT (floor(minute / ${step})::int * ${step}) AS bucket,
      u.ord::int AS idx, sum(u.v)::float8 AS c
    FROM edge_stat_minute, unnest(latency_buckets) WITH ORDINALITY AS u(v, ord)
    WHERE ${hostPredicate} AND minute >= ${fromMinute}
    GROUP BY 1, 2
  `);
  for (const raw of executeRows(histRes)) {
    const row = histogramAggRow.safeParse(raw);
    if (!row.success) continue;
    const r = row.data;
    const b = buckets.get(r.bucket * 60_000);
    // ordinality is 1-based.
    if (b && r.idx >= 1 && r.idx <= LATENCY_BUCKET_COUNT) {
      b.histogram[r.idx - 1] = (b.histogram[r.idx - 1] ?? 0) + r.c;
    }
  }
  return buckets;
}

/** Day-granular series: each merged day row IS a bucket contribution. */
export function foldDayRowsIntoBuckets(
  buckets: Map<number, InternalBucket>,
  dayRows: readonly DayAcc[],
): void {
  for (const row of dayRows) {
    const startMs = Date.UTC(
      Number(row.day.slice(0, 4)),
      Number(row.day.slice(4, 6)) - 1,
      Number(row.day.slice(6, 8)),
    );
    let b = buckets.get(startMs);
    if (!b) {
      b = newInternalBucket(startMs);
      buckets.set(startMs, b);
    }
    addIntoBucket(b, row);
  }
}

/** Live unflushed minute accs: pure additions (flushed accs left the map).
 *  Returns whether anything was merged, for the `source` honesty flag. */
export function foldLiveMinutesIntoBuckets(
  buckets: Map<number, InternalBucket>,
  live: readonly MinuteAcc[],
  /** null = install-wide: every host passes. */
  hostSet: ReadonlySet<string> | null,
  fromMs: number,
  bucketMs: number,
): boolean {
  let used = false;
  for (const acc of live) {
    if (hostSet !== null && !hostSet.has(acc.host)) continue;
    const accMs = acc.minute * 60_000;
    if (accMs < fromMs) continue;
    const startMs = Math.floor(accMs / bucketMs) * bucketMs;
    let b = buckets.get(startMs);
    if (!b) {
      b = newInternalBucket(startMs);
      buckets.set(startMs, b);
    }
    addIntoBucket(b, acc);
    used = true;
  }
  return used;
}
