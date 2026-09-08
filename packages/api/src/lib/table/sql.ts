/**
 * The SQL half of the filter semantics.
 *
 * Compiles the canonical operations from `@otterdeploy/shared/table-filters`
 * into Postgres predicates. Nothing here inspects the shape of a filter VALUE —
 * it only ever sees an operation the declared semantics already chose, which is
 * why a numeric checkbox cannot compile to `BETWEEN` here while behaving as a
 * set membership on the client.
 *
 * The switch is exhaustive with no default branch: an eighth operation fails to
 * compile in this file rather than silently matching nothing in production.
 */

import type { FilterOp, FilterSelection, Filters } from "@otterdeploy/shared/table-filters";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { and, between, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";

/**
 * Filter key → database column. The one place UI names and DB names meet.
 *
 * It doubles as the projection (see `feed.ts`), so rows come back keyed by
 * filter keys and nobody has to maintain the inverse mapping.
 */
export type ColumnMap = Record<string, PgColumn>;

/**
 * LIKE metacharacters are escaped, so a `%` typed into a search box matches a
 * literal percent sign.
 *
 * The in-memory engine does a plain `includes`, which has no metacharacters at
 * all — leaving these unescaped is exactly how the two engines would disagree
 * about what the user typed.
 */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * An `Instant` at the driver seam.
 *
 * `Date` exists in this project only where a library demands one, and the
 * Postgres driver is that seam: a `timestamp` column binds a `Date`.
 */
function bindInstant(instant: { epochMilliseconds: number }): Date {
  return new Date(instant.epochMilliseconds);
}

/** Case-insensitive contains, matching the in-memory engine's `includes`. */
function contains(column: PgColumn, value: string): SQL {
  return ilike(column, `%${likeLiteral(value)}%`);
}

/**
 * One text box over several columns: every mapped column OR-ed together.
 *
 * An unmapped column is skipped rather than widening the match to every row.
 */
function containsAny(keys: readonly string[], value: string, columns: ColumnMap): SQL | null {
  const clauses: SQL[] = [];
  for (const key of keys) {
    const column = columns[key];
    if (column) clauses.push(contains(column, value));
  }
  return clauses.length === 0 ? null : (or(...clauses) ?? null);
}

/**
 * The column's SQL type as DDL writes it, array dimensions included.
 *
 * Drizzle keeps `.array()` on the column itself rather than wrapping it in a
 * distinct type, so `getSQLType()` answers with the BASE type (`text`) and the
 * dimensions live beside it. Reading only the base type is how a cast becomes
 * `::text` for a `text[]` column — which Postgres rejects at query time, since
 * `&&` resolves no implicit casts. The `endsWith` guard keeps this correct if a
 * future version folds the dimensions back into `getSQLType()`.
 */
function sqlTypeOf(column: PgColumn): string {
  const base = column.getSQLType();
  if (base.endsWith("[]")) return base;
  return base + "[]".repeat(column.dimensions ?? 0);
}

/** Does this column hold an array? Decides `&&` vs `IN`, and facet unnesting. */
export function isArrayColumn(column: PgColumn): boolean {
  return (column.dimensions ?? 0) > 0 || column.getSQLType().endsWith("[]");
}

/**
 * Postgres array overlap: the column is a set on both sides.
 *
 * The literal is cast to the column's OWN array type, read off the schema,
 * because `&&` resolves no implicit casts whatsoever — `integer[] && text[]` is
 * a type error, and so is `integer[] && numeric[]`. A hardcoded `::text[]`
 * breaks every non-text array column, and the declared item kind cannot supply
 * it either (a `number` item says nothing about `integer[]` vs `bigint[]` vs
 * `double precision[]`). The column knows, so `sqlTypeOf` asks it.
 *
 * `sql.raw` is safe here for the same reason `${column}` is: the type comes
 * from the Drizzle schema, never from a request.
 */
function overlaps(column: PgColumn, values: readonly (string | number | boolean)[]): SQL {
  return sql`${column} && ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::${sql.raw(sqlTypeOf(column))}`;
}

/** Compile one canonical operation. `null` when no column is mapped for it. */
export function toSql(op: FilterOp, columns: ColumnMap): SQL | null {
  if (op.op === "substringAny") return containsAny(op.keys, op.value, columns);

  const column = columns[op.key];
  if (!column) return null;

  switch (op.op) {
    case "substring":
      return contains(column, op.value);
    case "equals":
      return eq(column, op.value);
    case "oneOf":
      return inArray(column, op.values);
    case "overlaps":
      return overlaps(column, op.values);
    case "numberRange":
      return between(column, op.min, op.max);
    case "instantRange":
      // Inclusive on both ends, matching `evaluateOp`.
      return and(gte(column, bindInstant(op.from)), lte(column, bindInstant(op.to))) ?? null;
  }
}

/**
 * Filter values → SQL predicates.
 *
 * `selection` is the three-pass strategy's knob: pass 1 takes only the date
 * keys, pass 2 excludes the sliders (so slider facet bounds are computed over a
 * set the sliders themselves do not narrow), pass 3 takes everything.
 */
export function buildWhere(
  filters: Filters,
  values: Record<string, unknown>,
  columns: ColumnMap,
  selection?: FilterSelection,
): SQL[] {
  const conditions: SQL[] = [];
  for (const op of filters.plan(values, selection)) {
    const clause = toSql(op, columns);
    if (clause) conditions.push(clause);
  }
  return conditions;
}

/** AND a list of predicates, or `undefined` when there are none. */
export function allOf(conditions: readonly SQL[]): SQL | undefined {
  if (conditions.length === 0) return undefined;
  return and(...conditions);
}
