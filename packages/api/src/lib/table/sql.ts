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
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { and, between, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";

/**
 * Filter key → database column. The one place UI names and DB names meet.
 *
 * It doubles as the projection (see `feed.ts`), so rows come back keyed by
 * filter keys and nobody has to maintain the inverse mapping.
 */
/**
 * What a filter key compiles to.
 *
 * Usually a real column. An `SQL` expression is allowed so a feed can offer a
 * DERIVED key — `case when ended_at is null then 'active' else 'expired' end`
 * being the one that forced it: the firewall's live/expired filter is the first
 * question anyone asks that table, the state is a reading of `ended_at` rather
 * than a stored value, and without this the key had nowhere to compile to.
 *
 * An expression is a first-class filter target: `eq`, `inArray`, `between` and
 * `ilike` all take a `SQLWrapper`. A BARE expression is treated as a scalar,
 * because the `&&` path has to cast its literal to the target's own array type
 * and an expression has no schema to read one off. An expression that holds an
 * array says so, and supplies that type, by being wrapped in {@link arrayExpr}.
 */
export type ColumnMap = Record<string, FilterTarget>;

/** Everything a filter key may compile to. */
export type FilterTarget = PgColumn | SQL | ArrayTarget;

/**
 * A derived ARRAY key: the expression, plus the array type it evaluates to.
 *
 * The paragraph above says an expression cannot be an array column because the
 * `&&` path reads the type off the schema and an expression has no schema. This
 * is that missing piece — the caller supplies what could not be read. Nothing
 * else changes: `&&` and `unnest` work on any array-valued expression.
 *
 * What forced it: the Caddy event feed's host scope. An event is visible when
 * its `host` OR any of its batch `domains` is a domain the caller owns, so the
 * filterable key is `(host || domains) ∩ owned` — a value that varies per
 * request, over a `jsonb` column rather than a `text[]` one. There is no column
 * to point at, and the type cannot be inferred from either end.
 *
 * The type is written by the caller and interpolated with `sql.raw`, so it must
 * come from code, never from a request — the same rule `sqlTypeOf` obeys when
 * it reads the type off the schema.
 */
export interface ArrayTarget {
  readonly expression: SQL;
  /** Its Postgres array type as DDL writes it, e.g. `text[]`. */
  readonly arrayType: string;
}

export function arrayExpr(expression: SQL, arrayType: string): ArrayTarget {
  return { expression, arrayType };
}

export function isArrayTarget(target: FilterTarget): target is ArrayTarget {
  return "arrayType" in target && typeof target.arrayType === "string";
}

/** Distinguishes a mapped column from a mapped expression. */
export function isColumn(target: FilterTarget): target is PgColumn {
  return "getSQLType" in target && typeof target.getSQLType === "function";
}

/**
 * The form a target takes in a `SELECT`, an `ORDER BY` or an `unnest`.
 *
 * An `ArrayTarget` is a wrapper carrying one extra fact; everywhere that fact
 * is not the question, it is just its expression.
 */
export function expressionOf(target: FilterTarget): PgColumn | SQL {
  return isArrayTarget(target) ? target.expression : target;
}

/**
 * The union, as the one thing every operator accepts.
 *
 * `eq`, `inArray`, `between` and friends are overloaded on `Column` and on
 * `SQLWrapper` separately, and a union of the two resolves to neither. Both
 * arms ARE `SQLWrapper`, so widening once here is enough — an annotation, not
 * an assertion, so nothing is being claimed that the types do not already know.
 */
function operand(target: FilterTarget): SQLWrapper {
  return expressionOf(target);
}

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
function contains(column: FilterTarget, value: string): SQL {
  return ilike(operand(column), `%${likeLiteral(value)}%`);
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

/** Does this target hold an array? Decides `&&` vs `IN`, and facet unnesting.
 *  A bare expression is never one; an {@link ArrayTarget} always is. */
export function isArrayColumn(column: FilterTarget): boolean {
  if (isArrayTarget(column)) return true;
  if (!isColumn(column)) return false;
  return (column.dimensions ?? 0) > 0 || column.getSQLType().endsWith("[]");
}

/**
 * Postgres array overlap: the column is a set on both sides.
 *
 * The literal is cast to the target's OWN array type — read off the schema for
 * a column, declared by the caller for an {@link ArrayTarget} — because `&&`
 * resolves no implicit casts whatsoever — `integer[] && text[]` is
 * a type error, and so is `integer[] && numeric[]`. A hardcoded `::text[]`
 * breaks every non-text array column, and the declared item kind cannot supply
 * it either (a `number` item says nothing about `integer[]` vs `bigint[]` vs
 * `double precision[]`). The column knows, so `sqlTypeOf` asks it.
 *
 * `sql.raw` is safe here for the same reason `${column}` is: the type comes
 * from the Drizzle schema, never from a request.
 */
function overlaps(
  target: PgColumn | ArrayTarget,
  values: readonly (string | number | boolean)[],
): SQL {
  const arrayType = isArrayTarget(target) ? target.arrayType : sqlTypeOf(target);
  return sql`${expressionOf(target)} && ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::${sql.raw(arrayType)}`;
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
      return eq(operand(column), op.value);
    case "oneOf":
      return inArray(operand(column), op.values);
    case "overlaps":
      // A real array column, or an expression that declared its array type. A
      // bare expression falls back to membership, which is what `overlaps`
      // means for a scalar anyway.
      return isColumn(column) || isArrayTarget(column)
        ? overlaps(column, op.values)
        : inArray(operand(column), op.values);
    case "numberRange":
      return between(operand(column), op.min, op.max);
    case "instantRange":
      // Inclusive on both ends, matching `evaluateOp`.
      return (
        and(gte(operand(column), bindInstant(op.from)), lte(operand(column), bindInstant(op.to))) ??
        null
      );
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
