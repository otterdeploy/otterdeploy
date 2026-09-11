/**
 * Faceted counts: how many rows each filter option would match, right now.
 *
 * A checkbox list without counts asks the reader to guess. With them, "error
 * 128 · warn 12 · info 0" answers the question before a single click, and an
 * option with no rows says so instead of looking available.
 *
 * Which set the counts are computed over is the subtle part, and it is the
 * caller's decision (see the three passes in `feed.ts`). Both kinds of facet
 * are counted over a set their OWN filter did not narrow: a slider whose bounds
 * came from its own range collapses under the pointer, and a checkbox list
 * counted after its own selection sends every unticked option to zero — so
 * ticking one box empties the list it lives in.
 *
 * Hence `where` is per KEY rather than one clause for all of them. The queries
 * already run in parallel, so a clause each costs nothing.
 */

import type { SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { count, max, min, sql } from "drizzle-orm";

import type { ColumnMap, FilterTarget } from "./sql";
import type { FeedDatabase } from "./types";

import { allOf, expressionOf, isArrayColumn } from "./sql";

/** One filter key's facet: option counts, plus bounds for a numeric column. */
export interface Facet {
  rows: { value: string | number | boolean; total: number }[];
  /** Rows the facet was computed over. */
  total: number;
  /**
   * Distinct values in the filtered set, when more than `rows` holds.
   *
   * Only set for a CAPPED facet, and only when the cap actually bit. It is
   * what lets the sidebar say "top 50 of 12,431" instead of presenting a
   * truncated list as if it were the whole one.
   */
  groups?: number;
  min?: number;
  max?: number;
}

export type Facets = Record<string, Facet>;

/** A row shape both `db.execute` result forms can be read through. */
interface CountedValue {
  value: string | number | boolean | null;
  total: number | string;
  /** Present on a capped facet: rows counted, and distinct values, overall. */
  scanned?: number | string;
  groups?: number | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumeric(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

function isCountedValue(row: unknown): row is CountedValue {
  if (!isRecord(row)) return false;
  if (!isNumeric(row.total)) return false;
  // The capped form carries two extra aggregates. Both optional, and both
  // read through the same guard rather than trusted because they arrive.
  if (row.scanned !== undefined && !isNumeric(row.scanned)) return false;
  return row.groups === undefined || isNumeric(row.groups);
}

/**
 * Read the rows out of a raw `db.execute` result.
 *
 * Drivers disagree about the shape: some return the array, some wrap it in
 * `{ rows }`. Both are read through a guard rather than an assertion, and an
 * unrecognised shape yields no facet rather than a crash in a list endpoint.
 */
function resultRows(result: unknown): CountedValue[] {
  const candidate = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.rows)
      ? result.rows
      : [];
  return candidate.filter(isCountedValue);
}

/**
 * The grouped counts, as a query over the table.
 *
 * An array is unnested first, so `["deploy","build"]` counts as one row for
 * each tag rather than one row for the pair.
 *
 * `GROUP BY 1`, not `GROUP BY <the expression again>`: a second interpolation
 * binds its own placeholders, and `case when path ~* $2 …` is not the same
 * expression as `case when path ~* $1 …` as far as the grouping check is
 * concerned. Faceting any DERIVED scalar key — the access log's `suspicious`,
 * the firewall's `state` — would have failed on that. Same trap, same fix, as
 * the histogram's own GROUP BY.
 */
function groupedSource(target: FilterTarget, table: PgTable, where: SQL | undefined): SQL {
  const column = expressionOf(target);
  const filtered = where ? sql` WHERE ${where}` : sql``;
  return isArrayColumn(target)
    ? sql`SELECT val AS value, COUNT(*)::int AS total
          FROM (SELECT unnest(${column}) AS val FROM ${table}${filtered}) unnested
          GROUP BY 1`
    : sql`SELECT ${column} AS value, COUNT(*)::int AS total
          FROM ${table}${filtered}
          GROUP BY 1`;
}

/**
 * Option counts for one key, optionally capped to the busiest `limit` values.
 *
 * The cap is not cosmetic. `client_ip` over a day of edge traffic has tens of
 * thousands of distinct values, and an uncapped facet ships every one of them
 * on the first page of every request, then renders them as a list nobody can
 * read. Capped, the same query answers the question that list was ever for:
 * which addresses are responsible for the most of this.
 *
 * The totals still describe the WHOLE set. They are computed inside the CTE,
 * before the cap, so "top 50 of 12,431" is two true numbers rather than a
 * truncated list quietly reporting itself as complete.
 */
async function groupedFacet(
  db: FeedDatabase,
  target: FilterTarget,
  table: PgTable,
  where: SQL | undefined,
  limit?: number,
): Promise<Facet> {
  const grouped = groupedSource(target, table, where);
  const statement =
    limit === undefined
      ? sql`${grouped} ORDER BY total DESC, value ASC`
      : sql`WITH grouped AS (${grouped})
            SELECT value, total,
                   (SELECT COALESCE(SUM(total), 0)::int FROM grouped) AS scanned,
                   (SELECT COUNT(*)::int FROM grouped) AS groups
            FROM grouped
            ORDER BY total DESC, value ASC
            LIMIT ${limit}`;

  const rows: Facet["rows"] = [];
  let summed = 0;
  let scanned: number | undefined;
  let groups: number | undefined;
  for (const row of resultRows(await db.execute(statement))) {
    // A NULL group is a real answer to "how many rows have no value", but it is
    // not a selectable option, so it counts toward the total and nothing else.
    const amount = Number(row.total);
    summed += amount;
    if (row.scanned !== undefined) scanned = Number(row.scanned);
    if (row.groups !== undefined) groups = Number(row.groups);
    if (row.value === null) continue;
    rows.push({ value: row.value, total: amount });
  }
  // Under the cap the returned groups ARE every group, so saying how many there
  // are would only invite a "top 12 of 12" nobody needs to read.
  const capped = groups !== undefined && groups > rows.length;
  return { rows, total: scanned ?? summed, ...(capped ? { groups } : {}) };
}

async function boundsFacet(
  db: FeedDatabase,
  target: FilterTarget,
  table: PgTable,
  where: SQL | undefined,
): Promise<Facet> {
  const column = expressionOf(target);
  const [row] = await db
    .select({ low: min(column), high: max(column), total: count() })
    .from(table)
    .where(where);

  const low = Number(row?.low ?? Number.NaN);
  const high = Number(row?.high ?? Number.NaN);
  return {
    rows: [],
    total: row?.total ?? 0,
    ...(Number.isFinite(low) ? { min: low } : {}),
    ...(Number.isFinite(high) ? { max: high } : {}),
  };
}

/**
 * Compute several facets at once.
 *
 * Every facet is an independent aggregate, so they run in parallel: the wall
 * clock is one query deep, not one per filter. Each gets its OWN clause, which
 * is what lets a facet be counted over a set its own filter did not narrow.
 */
export async function computeFacets(params: {
  db: FeedDatabase;
  table: PgTable;
  columns: ColumnMap;
  /** The clause for one key. Called once per key. */
  where: (key: string) => readonly SQL[];
  /** Keys to count values for. */
  keys: readonly string[];
  /** Keys to report min/max for instead of grouped counts. */
  boundsKeys?: readonly string[];
  /** Cap on option counts per key. Unset means every distinct value. */
  limit?: number;
}): Promise<Facets> {
  const { db, table, columns, keys, boundsKeys = [], limit } = params;

  const computed = await Promise.all(
    keys.map(async (key) => {
      const column = columns[key];
      if (!column) return null;
      const where = allOf(params.where(key));
      const facet = boundsKeys.includes(key)
        ? await boundsFacet(db, column, table, where)
        : await groupedFacet(db, column, table, where, limit);
      return [key, facet] as const;
    }),
  );

  const facets: Facets = {};
  for (const entry of computed) {
    if (entry) facets[entry[0]] = entry[1];
  }
  return facets;
}
