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

export interface RawBucket {
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
 * Grouped counts → the axis the chart draws.
 *
 * Pure, and separate from the query, because this is where the two histogram
 * decisions live and both are silent when wrong:
 *
 * - **Every bucket in the range is materialized**, including the ones nothing
 *   landed in. A gap is information — "nothing happened here" — and a series
 *   that skips it draws a continuous run of activity that never existed.
 * - **Buckets are anchored**, not started at the first row, so two windows of
 *   the same width line up with each other rather than being offset by whenever
 *   the first row happened to arrive.
 */
export function buildBuckets(
  rows: readonly RawBucket[],
  window: { anchorMs: number; toMs: number; bucketMs: number },
): HistogramBucket[] {
  const { anchorMs, toMs, bucketMs } = window;
  const counted = new Map<number, HistogramBucket>();

  for (const row of rows) {
    const at = bucketStart(row.at);
    if (at === null) continue;
    const bucket = counted.get(at) ?? { at, total: 0, by: {} };
    const amount = Number(row.total);
    bucket.total += amount;
    // A null category is the "no breakdown" case, not a category named "null".
    if (row.category !== null) {
      bucket.by[row.category] = (bucket.by[row.category] ?? 0) + amount;
    }
    counted.set(at, bucket);
  }

  const buckets: HistogramBucket[] = [];
  for (let at = anchorMs; at <= toMs; at += bucketMs) {
    buckets.push(counted.get(at) ?? { at, total: 0, by: {} });
  }
  return buckets;
}

/**
 * The bucketing query.
 *
 * Split out so its shape can be pinned by a test without a database — the one
 * bug it has had was a GROUP BY that Postgres accepts on most tables and
 * misreads on some, which no amount of row-level testing would have found.
 *
 * Grouped by ORDINAL, which is neither of the two things that do not work.
 *
 * `GROUP BY at, category` looks right and is not: Postgres resolves a bare
 * name in GROUP BY against the INPUT columns first, falling back to an output
 * alias only if none matches. `edge_event` has its own `category` column, so
 * the clause bound to that, left the SELECTed `level` ungrouped, and the query
 * failed outright. The quieter version of the same bug is a table with its own
 * `at` column: no error, just buckets over the wrong timestamp.
 *
 * Repeating the expressions instead does not work either. Each interpolation
 * binds its own placeholders, and `date_bin(…, $5, $6)` is not the same
 * expression as `date_bin(…, $1, $2)` as far as the grouping check is
 * concerned — so the SELECT's own bin went ungrouped in its turn.
 *
 * An ordinal names the output column and nothing else.
 */
export function histogramStatement(params: {
  table: PgTable;
  timeColumn: Column;
  categoryColumn?: Column | SQL;
  where: readonly SQL[];
  /** Bucket boundary both sides anchor to. */
  anchorMs: number;
  bucketMs: number;
}): SQL {
  const { table, timeColumn, categoryColumn, anchorMs, bucketMs } = params;
  const where = allOf(params.where);
  const interval = sql`make_interval(secs => ${bucketMs / 1000})`;
  const bin = sql`date_bin(${interval}, ${timeColumn}, ${new Date(anchorMs)})`;
  const category = categoryColumn ? sql`${categoryColumn}::text` : sql`NULL::text`;

  return sql`SELECT ${bin} AS at, ${category} AS category, COUNT(*)::int AS total
    FROM ${table}${where ? sql` WHERE ${where}` : sql``}
    GROUP BY 1, 2
    ORDER BY 1 ASC`;
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
  /**
   * What to break each bucket down by (level, outcome, status class).
   *
   * An SQL expression as well as a column, because the useful breakdown is not
   * always stored: an access log's bands are `2xx`/`4xx`/`5xx`, and grouping by
   * the raw status code instead draws forty bands nobody can read.
   */
  categoryColumn?: Column | SQL;
  where: readonly SQL[];
  range: TimeRange;
  bucketMs?: number;
}): Promise<{ buckets: HistogramBucket[]; bucketMs: number }> {
  const { db, table, timeColumn, categoryColumn, range } = params;
  const bucketMs = params.bucketMs ?? bucketMsFor(range.toMs - range.fromMs);

  // Both sides anchor to the same rounded boundary, so the buckets Postgres
  // returns land exactly on the ones this function materializes — and two
  // windows of the same width line up with each other instead of being offset
  // by whenever the first row happened to arrive.
  const anchorMs = Math.floor(range.fromMs / bucketMs) * bucketMs;

  const statement = histogramStatement({
    table,
    timeColumn,
    categoryColumn,
    where: params.where,
    anchorMs,
    bucketMs,
  });

  const rows = rawRows(await db.execute(statement));
  return { buckets: buildBuckets(rows, { anchorMs, toMs: range.toMs, bucketMs }), bucketMs };
}
