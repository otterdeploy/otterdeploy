/**
 * The filter model, compiled to parameterized SQL by Drizzle.
 *
 * Two things this fixes at once.
 *
 * The viewer it replaces built its WHERE clause by escaping quotes and splicing
 * the value into the string (`ILIKE '%${esc(f.value)}%'`). That is not wrong
 * today, but "the escaping is correct" is a property you cannot test into
 * existence, and it stops being true the moment a dialect with backslash
 * escapes uses the same code.
 *
 * The first rewrite of this file hand-rolled the replacement: its own
 * `quoteIdent`, its own placeholder counter, its own IN-list expansion. That is
 * the same class of mistake one layer up. Drizzle already does all of it, per
 * dialect, and is already a dependency of this repo — so identifier escaping
 * (`"we""ird"` vs `` `we``ird` ``), placeholder numbering (`$1` vs `?`) and
 * list expansion are delegated, not reimplemented.
 *
 * The column NAME still has to be interpolated, because SQL has no placeholder
 * for an identifier. It is therefore checked against the table's real column
 * list by {@link compileFilters} — a filter naming a column that does not exist
 * compiles to nothing rather than to injected SQL. Drizzle's `sql.identifier`
 * escapes it on top of that.
 */
import type { SQL } from "drizzle-orm";

import { sql } from "drizzle-orm";
import * as z from "zod";

import type { Dialect } from "./dialect";
import type { PreparedStatement, Sort } from "./types";
import type { CellKind } from "./value";

import { parseCell, toDriverParam } from "./value";

export const FILTER_OPS = [
  "eq",
  "ne",
  "gt",
  "lt",
  "gte",
  "lte",
  "contains",
  "notcontains",
  "startswith",
  "endswith",
  "in",
  "notin",
  "between",
  "isnull",
  "notnull",
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];
export const filterOpSchema = z.enum(FILTER_OPS);

export const filterSchema = z.object({
  column: z.string().min(1).max(255),
  op: filterOpSchema,
  /**
   * Operand text as the user typed it. `in`/`notin` take many, `between` takes
   * exactly two, `isnull`/`notnull` take none, everything else takes one.
   * Kept as strings so the same filter survives a column type change; it is
   * coerced to the column's real kind at compile time.
   */
  values: z.array(z.string()).max(200).default([]),
  /** An unchecked filter stays in the list and out of the query. */
  enabled: z.boolean().default(true),
});
export type Filter = z.infer<typeof filterSchema>;

export interface FilterOpMeta {
  label: string;
  /** How many operands the operator consumes. `-1` means "one or more". */
  arity: 0 | 1 | 2 | -1;
  /** Grouping for the operator picker. */
  group: "comparison" | "text" | "list" | "null" | "range";
}

export const FILTER_OP_META: Record<FilterOp, FilterOpMeta> = {
  eq: { label: "equals", arity: 1, group: "comparison" },
  ne: { label: "not equals", arity: 1, group: "comparison" },
  gt: { label: "greater than", arity: 1, group: "comparison" },
  lt: { label: "less than", arity: 1, group: "comparison" },
  gte: { label: "at least", arity: 1, group: "comparison" },
  lte: { label: "at most", arity: 1, group: "comparison" },
  contains: { label: "contains", arity: 1, group: "text" },
  notcontains: { label: "does not contain", arity: 1, group: "text" },
  startswith: { label: "starts with", arity: 1, group: "text" },
  endswith: { label: "ends with", arity: 1, group: "text" },
  in: { label: "is any of", arity: -1, group: "list" },
  notin: { label: "is none of", arity: -1, group: "list" },
  between: { label: "between", arity: 2, group: "range" },
  isnull: { label: "is null", arity: 0, group: "null" },
  notnull: { label: "is not null", arity: 0, group: "null" },
};

/** Operator picker groups, in display order. */
export const FILTER_OP_GROUPS = [
  { group: "comparison", label: "Comparison" },
  { group: "text", label: "Text" },
  { group: "range", label: "Range" },
  { group: "list", label: "List" },
  { group: "null", label: "Null checks" },
] as const;

/** Structural check only: does this filter have the operands its op needs? */
export function isFilterComplete(filter: Filter): boolean {
  if (!filter.enabled || filter.column === "") return false;
  const { arity } = FILTER_OP_META[filter.op];
  if (arity === 0) return true;
  if (arity === -1) return filter.values.length > 0;
  return filter.values.length >= arity && filter.values.slice(0, arity).every((v) => v !== "");
}

/** Drop the filters that are switched off or half-filled. */
export function enabledFilters(filters: readonly Filter[]): Filter[] {
  return filters.filter(isFilterComplete);
}

/** Everything a compile needs to know about the columns it may reference. */
export interface ColumnLookup {
  /** The cell kind for a column name, or undefined when no such column exists. */
  kindOf(column: string): CellKind | undefined;
}

/** Builds a {@link ColumnLookup} from an introspected column list. */
export function columnLookup(
  columns: ReadonlyArray<{ name: string; kind: CellKind }>,
): ColumnLookup {
  const byName = new Map(columns.map((c) => [c.name, c.kind]));
  return { kindOf: (column) => byName.get(column) };
}

/**
 * A qualified table reference: `"schema"."table"`, or just `"table"` when the
 * dialect has no schemas or the caller passed none.
 *
 * Built from two `sql.identifier` calls rather than one on `"schema.table"` —
 * a single call would quote the dot INTO the name and produce `"public.orders"`,
 * which is a table whose name contains a period.
 */
export function qualified(dialect: Dialect, schema: string, table: string): SQL {
  const name = sql.identifier(table);
  if (!dialect.supportsSchemas || schema === "") return sql`${name}`;
  return sql`${sql.identifier(schema)}.${name}`;
}

/**
 * Coerce one operand to the column's kind, falling back to text.
 *
 * Falling back rather than dropping is deliberate: `created_at > 2026-01` is a
 * partial date the engine can still interpret, and refusing it would be more
 * annoying than useful. What we never do is coerce it to a *different* number.
 */
function operand(text: string, kind: CellKind): SQL {
  const cell = parseCell(text, kind);
  return sql`${toDriverParam(cell ?? { k: "text", v: text })}`;
}

/** Operators that are a plain binary comparison against one bound operand. */
const BINARY_SQL_OPS: Partial<Record<FilterOp, SQL>> = {
  eq: sql`=`,
  ne: sql`<>`,
  gt: sql`>`,
  lt: sql`<`,
  gte: sql`>=`,
  lte: sql`<=`,
};

const LIKE_OPS = new Set<FilterOp>(["contains", "notcontains", "startswith", "endswith"]);

/** `contains` / `startswith` / `endswith`, with wildcards in user text escaped. */
function likeClause(filter: Filter, kind: CellKind, col: SQL, dialect: Dialect): SQL {
  const raw = filter.values[0] ?? "";
  // `%` and `_` in user text are literal, not wildcards. Escaping them here is
  // what stops `50%` from matching every row that starts with "50".
  const escaped = raw.replace(/([\\%_])/g, "\\$1");
  const pattern =
    filter.op === "startswith"
      ? `${escaped}%`
      : filter.op === "endswith"
        ? `%${escaped}`
        : `%${escaped}%`;
  // Cast so LIKE works against numeric, uuid and enum columns too.
  const expr = kind === "text" ? col : dialect.castToText(col);
  return dialect.caseInsensitiveLike(expr, sql`${pattern}`, filter.op === "notcontains");
}

/** `in` / `notin`, one bound parameter per operand. */
function listClause(filter: Filter, kind: CellKind, col: SQL): SQL | null {
  if (filter.values.length === 0) return null;
  const list = sql.join(
    filter.values.map((v) => operand(v, kind)),
    sql`, `,
  );
  return filter.op === "in" ? sql`${col} IN (${list})` : sql`${col} NOT IN (${list})`;
}

function clauseFor(filter: Filter, dialect: Dialect, lookup: ColumnLookup): SQL | null {
  const kind = lookup.kindOf(filter.column);
  // A filter naming a column the table does not have compiles to nothing.
  // This is the check that makes referencing the identifier safe at all.
  if (kind === undefined) return null;

  const col = sql`${sql.identifier(filter.column)}`;

  if (filter.op === "isnull") return sql`${col} IS NULL`;
  if (filter.op === "notnull") return sql`${col} IS NOT NULL`;

  const binary = BINARY_SQL_OPS[filter.op];
  if (binary !== undefined) {
    return sql`${col} ${binary} ${operand(filter.values[0] ?? "", kind)}`;
  }

  if (filter.op === "between") {
    const lo = operand(filter.values[0] ?? "", kind);
    const hi = operand(filter.values[1] ?? "", kind);
    return sql`${col} BETWEEN ${lo} AND ${hi}`;
  }

  if (LIKE_OPS.has(filter.op)) return likeClause(filter, kind, col, dialect);
  return listClause(filter, kind, col);
}

/** The `WHERE …` fragment, or null when nothing compiles. */
export function whereFragment(
  filters: readonly Filter[],
  dialect: Dialect,
  lookup: ColumnLookup,
): SQL | null {
  const clauses = enabledFilters(filters)
    .map((f) => clauseFor(f, dialect, lookup))
    .filter((c): c is SQL => c !== null);
  if (clauses.length === 0) return null;
  return sql` WHERE ${sql.join(clauses, sql` AND `)}`;
}

/** The `ORDER BY …` fragment, dropping sorts on columns the table lacks. */
export function orderByFragment(
  sorts: readonly Sort[],
  dialect: Dialect,
  lookup: ColumnLookup,
): SQL | null {
  const terms = sorts
    .filter((s) => lookup.kindOf(s.column) !== undefined)
    .map((s) => dialect.orderByTerm(sql`${sql.identifier(s.column)}`, s.direction, s.nulls));
  if (terms.length === 0) return null;
  return sql` ORDER BY ${sql.join(terms, sql`, `)}`;
}

/** Compile a fragment to `{ sql, params }` with the dialect's own compiler. */
export function compile(dialect: Dialect, query: SQL): PreparedStatement {
  const { sql: text, params } = dialect.compiler().sqlToQuery(query);
  return { sql: text, params };
}

/** Just the WHERE clause, compiled. Exported for tests and for `count`. */
export function compileFilters(
  filters: readonly Filter[],
  dialect: Dialect,
  lookup: ColumnLookup,
): PreparedStatement {
  const where = whereFragment(filters, dialect, lookup);
  return where === null ? { sql: "", params: [] } : compile(dialect, where);
}

/**
 * The browse query behind the grid: one table, filtered, sorted, paged.
 *
 * `limit` is fetched with one extra row so the caller can report `truncated`
 * honestly without a second `count(*)` over the filtered set.
 *
 * LIMIT/OFFSET are inlined as literals rather than bound, because they are
 * server-validated integers from the contract (`z.number().int().max(1000)`)
 * and MySQL will not accept a placeholder in `LIMIT` on a prepared statement.
 */
export function buildSelect(input: {
  dialect: Dialect;
  schema: string;
  table: string;
  columns: readonly string[];
  filters: readonly Filter[];
  sorts: readonly Sort[];
  limit: number;
  offset: number;
  lookup: ColumnLookup;
}): PreparedStatement {
  const { dialect, lookup } = input;
  const selected = input.columns.filter((c) => lookup.kindOf(c) !== undefined);
  const projection =
    selected.length === 0
      ? sql`*`
      : sql.join(
          selected.map((c) => sql`${sql.identifier(c)}`),
          sql`, `,
        );

  const where = whereFragment(input.filters, dialect, lookup);
  const order = orderByFragment(input.sorts, dialect, lookup);
  const limit = Math.trunc(input.limit) + 1;
  const offset = Math.trunc(input.offset);

  const query = sql`SELECT ${projection} FROM ${qualified(dialect, input.schema, input.table)}${
    where ?? sql``
  }${order ?? sql``} LIMIT ${sql.raw(String(limit))} OFFSET ${sql.raw(String(offset))}`;
  return compile(dialect, query);
}

/** `count(*)` over the same filtered set, for the footer's exact total. */
export function buildCount(input: {
  dialect: Dialect;
  schema: string;
  table: string;
  filters: readonly Filter[];
  lookup: ColumnLookup;
}): PreparedStatement {
  const where = whereFragment(input.filters, input.dialect, input.lookup);
  const query = sql`SELECT count(*) AS total FROM ${qualified(
    input.dialect,
    input.schema,
    input.table,
  )}${where ?? sql``}`;
  return compile(input.dialect, query);
}
