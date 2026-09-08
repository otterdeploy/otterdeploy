/**
 * Faceted counts: how many rows each filter option would match, right now.
 *
 * A checkbox list without counts asks the reader to guess. With them, "error
 * 128 · warn 12 · info 0" answers the question before a single click, and an
 * option with no rows says so instead of looking available.
 *
 * Which set the counts are computed over is the subtle part, and it is the
 * caller's decision (see the three passes in `feed.ts`): checkbox facets come
 * from the fully filtered set, slider bounds from a set the sliders themselves
 * did not narrow — otherwise dragging a slider collapses its own range.
 */

import type { SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { count, max, min, sql } from "drizzle-orm";

import type { ColumnMap } from "./sql";
import type { FeedDatabase } from "./types";

import { allOf, isArrayColumn } from "./sql";

/** One filter key's facet: option counts, plus bounds for a numeric column. */
export interface Facet {
  rows: { value: string | number | boolean; total: number }[];
  /** Rows the facet was computed over. */
  total: number;
  min?: number;
  max?: number;
}

export type Facets = Record<string, Facet>;

/** A row shape both `db.execute` result forms can be read through. */
interface CountedValue {
  value: string | number | boolean | null;
  total: number | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCountedValue(row: unknown): row is CountedValue {
  if (!isRecord(row)) return false;
  const total = row.total;
  return typeof total === "number" || typeof total === "string";
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

async function groupedFacet(
  db: FeedDatabase,
  table: PgTable,
  column: PgColumn,
  where: SQL | undefined,
): Promise<Facet> {
  const unnested = isArrayColumn(column);
  // An array column is unnested first, so `["deploy","build"]` counts as one
  // row for each tag rather than one row for the pair.
  const statement = unnested
    ? sql`SELECT val AS value, COUNT(*)::int AS total
          FROM (SELECT unnest(${column}) AS val FROM ${table}${
            where ? sql` WHERE ${where}` : sql``
          }) unnested
          GROUP BY val
          ORDER BY total DESC, value ASC`
    : sql`SELECT ${column} AS value, COUNT(*)::int AS total
          FROM ${table}${where ? sql` WHERE ${where}` : sql``}
          GROUP BY ${column}
          ORDER BY total DESC, value ASC`;

  const rows: Facet["rows"] = [];
  let total = 0;
  for (const row of resultRows(await db.execute(statement))) {
    // A NULL group is a real answer to "how many rows have no value", but it is
    // not a selectable option, so it counts toward the total and nothing else.
    const amount = Number(row.total);
    total += amount;
    if (row.value === null) continue;
    rows.push({ value: row.value, total: amount });
  }
  return { rows, total };
}

async function boundsFacet(
  db: FeedDatabase,
  table: PgTable,
  column: PgColumn,
  where: SQL | undefined,
): Promise<Facet> {
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
 * Every facet is an independent aggregate over the same set, so they run in
 * parallel: the wall clock is one query deep, not one per filter.
 */
export async function computeFacets(params: {
  db: FeedDatabase;
  table: PgTable;
  columns: ColumnMap;
  where: readonly SQL[];
  /** Keys to count values for. */
  keys: readonly string[];
  /** Keys to report min/max for instead of grouped counts. */
  boundsKeys?: readonly string[];
}): Promise<Facets> {
  const { db, table, columns, keys, boundsKeys = [] } = params;
  const where = allOf(params.where);

  const computed = await Promise.all(
    keys.map(async (key) => {
      const column = columns[key];
      if (!column) return null;
      const facet = boundsKeys.includes(key)
        ? await boundsFacet(db, table, column, where)
        : await groupedFacet(db, table, column, where);
      return [key, facet] as const;
    }),
  );

  const facets: Facets = {};
  for (const entry of computed) {
    if (entry) facets[entry[0]] = entry[1];
  }
  return facets;
}
