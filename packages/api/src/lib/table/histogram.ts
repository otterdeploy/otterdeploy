/**
 * The time histogram over a filtered feed.
 *
 * Every log-shaped surface asks the same question before it asks any other:
 * *when did this happen, and was it always like this?* The answer is a bucketed
 * count over exactly the set the table is showing — so it is computed from the
 * feed's own WHERE clause rather than a second, subtly different query.
 *
 * Buckets come from a ladder rather than "divide the range by 60": a bucket
 * width of 3.7 seconds is unreadable on an axis, and comparing two windows is
 * only honest when both snap to the same set of widths.
 */

import type { Column, SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { max, min, sql } from "drizzle-orm";

import type { FeedDatabase } from "./types";

import { allOf } from "./sql";

/**
 * Bucket widths, in milliseconds. A range picks the first width that keeps the
 * bucket count under `TARGET_BUCKETS`, so an axis never carries more bars than
 * a reader can distinguish or fewer than shows a shape.
 */
const LADDER_MS: readonly number[] = [
  1_000, // 1s
  5_000,
  15_000,
  30_000,
  60_000, // 1m
  300_000,
  900_000,
  1_800_000,
  3_600_000, // 1h
  10_800_000,
  21_600_000,
  43_200_000,
  86_400_000, // 1d
  604_800_000, // 1w
];

const TARGET_BUCKETS = 60;
const WIDEST_MS = 2_592_000_000; // 30d, for ranges past the ladder

/** The bucket width for a span, in milliseconds. */
export function bucketMsFor(spanMs: number): number {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return LADDER_MS[0] ?? 1_000;
  for (const width of LADDER_MS) {
    if (spanMs / width <= TARGET_BUCKETS) return width;
  }
  return WIDEST_MS;
}

export interface TimeRange {
  fromMs: number;
  toMs: number;
}

/** MIN/MAX of the time column over the filtered set, when no range was given. */
export async function discoverRange(params: {
  db: FeedDatabase;
  table: PgTable;
  column: Column;
  where: readonly SQL[];
}): Promise<TimeRange | null> {
  const [row] = await params.db
    .select({ low: min(params.column), high: max(params.column) })
    .from(params.table)
    .where(allOf(params.where));

  const low = row?.low;
  const high = row?.high;
  if (!(low instanceof Date) || !(high instanceof Date)) return null;
  const fromMs = low.getTime();
  const toMs = high.getTime();
  return Number.isNaN(fromMs) || Number.isNaN(toMs) ? null : { fromMs, toMs };
}

/** One bucket: its start, its total, and a count per category. */
export interface HistogramBucket {
  /** Bucket start, epoch millis. */
  at: number;
  total: number;
  /** Counts keyed by the category column's value. Empty when no category. */
  by: Record<string, number>;
}

interface RawBucket {
  at: Date | string | number | null;
  category: string | null;
  total: number | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRawBucket(row: unknown): row is RawBucket {
  if (!isRecord(row)) return false;
  return typeof row.total === "number" || typeof row.total === "string";
}

function rawRows(result: unknown): RawBucket[] {
  const candidate = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.rows)
      ? result.rows
      : [];
  return candidate.filter(isRawBucket);
}

function bucketStart(value: RawBucket["at"]): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Count rows per time bucket over the feed's own filtered set.
 *
 * Empty buckets are materialized rather than omitted: a gap in a bar chart is
 * information ("nothing happened here"), and a series that silently skips it
 * draws a continuous run of activity that never existed.
 */
export async function computeHistogram(params: {
  db: FeedDatabase;
  table: PgTable;
  timeColumn: Column;
  /** Optional column to break each bucket down by (level, outcome, status). */
  categoryColumn?: Column;
  where: readonly SQL[];
  range: TimeRange;
  bucketMs?: number;
}): Promise<{ buckets: HistogramBucket[]; bucketMs: number }> {
  const { db, table, timeColumn, categoryColumn, range } = params;
  const bucketMs = params.bucketMs ?? bucketMsFor(range.toMs - range.fromMs);
  const where = allOf(params.where);

  // Both sides anchor to the same rounded boundary, so the buckets Postgres
  // returns land exactly on the ones this function materializes — and two
  // windows of the same width line up with each other instead of being offset
  // by whenever the first row happened to arrive.
  const anchorMs = Math.floor(range.fromMs / bucketMs) * bucketMs;
  const origin = new Date(anchorMs);
  const interval = sql`make_interval(secs => ${bucketMs / 1000})`;
  const bin = sql`date_bin(${interval}, ${timeColumn}, ${origin})`;
  const category = categoryColumn ? sql`${categoryColumn}::text` : sql`NULL::text`;

  const statement = sql`SELECT ${bin} AS at, ${category} AS category, COUNT(*)::int AS total
    FROM ${table}${where ? sql` WHERE ${where}` : sql``}
    GROUP BY at, category
    ORDER BY at ASC`;

  const counted = new Map<number, HistogramBucket>();
  for (const row of rawRows(await db.execute(statement))) {
    const at = bucketStart(row.at);
    if (at === null) continue;
    const bucket = counted.get(at) ?? { at, total: 0, by: {} };
    const amount = Number(row.total);
    bucket.total += amount;
    if (row.category !== null) {
      bucket.by[row.category] = (bucket.by[row.category] ?? 0) + amount;
    }
    counted.set(at, bucket);
  }

  // Materialize the whole axis, including the buckets nothing landed in.
  const buckets: HistogramBucket[] = [];
  for (let at = anchorMs; at <= range.toMs; at += bucketMs) {
    buckets.push(counted.get(at) ?? { at, total: 0, by: {} });
  }
  return { buckets, bucketMs };
}
