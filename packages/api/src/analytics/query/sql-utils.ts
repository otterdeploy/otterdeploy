/**
 * Small SQL plumbing shared by the analytics readers: instant formatting,
 * site-scope IN lists, half-open time-range predicates, and the row-array
 * unwrap for `db.execute` (bun-sql returns a plain array; tolerate a
 * `{ rows }` wrapper like edge-logs' loaders do, without asserting either).
 */

import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

import { Temporal } from "@otterdeploy/shared/temporal";
import { sql, type SQL } from "drizzle-orm";

export function isoOf(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toString();
}

/** `col IN (…)`. Callers guard the empty scope before building SQL. */
export function siteIdIn(col: SQL | SQL.Aliased, siteIds: readonly AnalyticsSiteId[]): SQL {
  return sql`${col} IN (${sql.join(
    siteIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/** Half-open [from, to) on a timestamptz column, bound as ISO strings with an
 *  explicit cast (a bare string param would bind as text). */
export function tsRange(col: SQL | SQL.Aliased, fromMs: number, toMs: number): SQL {
  return sql`${col} >= ${isoOf(fromMs)}::timestamptz AND ${col} < ${isoOf(toMs)}::timestamptz`;
}

/** Timezone-correct bucket start as epoch ms: truncate in the caller's zone,
 *  convert back so the label is a real instant. */
export function bucketMsExpr(col: SQL | SQL.Aliased, bucket: string, tz: string): SQL {
  return sql`(extract(epoch FROM date_trunc(${bucket}, ${col} AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) * 1000)::float8`;
}

export function executeRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object" && "rows" in value) {
    const rows = value.rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}
