/** Parameterized SQL compilation for the validated filter/sort model. */
import type { SQL } from "drizzle-orm";

import { sql } from "drizzle-orm";

import type { Dialect } from "./dialect";
import type { ColumnLookup, Filter, FilterOp } from "./filters";
import type { PreparedStatement, Sort } from "./types";
import type { CellKind } from "./value";

import { enabledFilters } from "./filters";
import { parseCell, toDriverParam } from "./value";

export function qualified(dialect: Dialect, schema: string, table: string): SQL {
  const name = sql.identifier(table);
  if (!dialect.supportsSchemas || schema === "") return sql`${name}`;
  return sql`${sql.identifier(schema)}.${name}`;
}

function operand(text: string, kind: CellKind): SQL {
  const cell = parseCell(text, kind);
  return sql`${toDriverParam(cell ?? { k: "text", v: text })}`;
}

const BINARY_SQL_OPS: Partial<Record<FilterOp, SQL>> = {
  eq: sql`=`,
  ne: sql`<>`,
  gt: sql`>`,
  lt: sql`<`,
  gte: sql`>=`,
  lte: sql`<=`,
};

const LIKE_OPS = new Set<FilterOp>(["contains", "notcontains", "startswith", "endswith"]);

function likeClause(filter: Filter, kind: CellKind, column: SQL, dialect: Dialect): SQL {
  const raw = filter.values[0] ?? "";
  const escaped = raw.replace(/([\\%_])/g, "\\$1");
  const pattern =
    filter.op === "startswith"
      ? `${escaped}%`
      : filter.op === "endswith"
        ? `%${escaped}`
        : `%${escaped}%`;
  const expression = kind === "text" ? column : dialect.castToText(column);
  return dialect.caseInsensitiveLike(expression, sql`${pattern}`, filter.op === "notcontains");
}

function listClause(filter: Filter, kind: CellKind, column: SQL): SQL | null {
  if (filter.values.length === 0) return null;
  const list = sql.join(
    filter.values.map((value) => operand(value, kind)),
    sql`, `,
  );
  return filter.op === "in" ? sql`${column} IN (${list})` : sql`${column} NOT IN (${list})`;
}

function clauseFor(filter: Filter, dialect: Dialect, lookup: ColumnLookup): SQL | null {
  const kind = lookup.kindOf(filter.column);
  if (kind === undefined) return null;
  const column = sql`${sql.identifier(filter.column)}`;
  if (filter.op === "isnull") return sql`${column} IS NULL`;
  if (filter.op === "notnull") return sql`${column} IS NOT NULL`;

  const binary = BINARY_SQL_OPS[filter.op];
  if (binary !== undefined) {
    return sql`${column} ${binary} ${operand(filter.values[0] ?? "", kind)}`;
  }
  if (filter.op === "between") {
    return sql`${column} BETWEEN ${operand(filter.values[0] ?? "", kind)} AND ${operand(
      filter.values[1] ?? "",
      kind,
    )}`;
  }
  if (LIKE_OPS.has(filter.op)) return likeClause(filter, kind, column, dialect);
  return listClause(filter, kind, column);
}

export function whereFragment(
  filters: readonly Filter[],
  dialect: Dialect,
  lookup: ColumnLookup,
): SQL | null {
  const clauses = enabledFilters(filters)
    .map((filter) => clauseFor(filter, dialect, lookup))
    .filter((clause): clause is SQL => clause !== null);
  return clauses.length === 0 ? null : sql` WHERE ${sql.join(clauses, sql` AND `)}`;
}

export function orderByFragment(
  sorts: readonly Sort[],
  dialect: Dialect,
  lookup: ColumnLookup,
): SQL | null {
  const terms = sorts
    .filter((sort) => lookup.kindOf(sort.column) !== undefined)
    .map((sort) =>
      dialect.orderByTerm(sql`${sql.identifier(sort.column)}`, sort.direction, sort.nulls),
    );
  return terms.length === 0 ? null : sql` ORDER BY ${sql.join(terms, sql`, `)}`;
}

export function compile(dialect: Dialect, query: SQL): PreparedStatement {
  const { sql: text, params } = dialect.compiler().sqlToQuery(query);
  return { sql: text, params };
}

export function compileFilters(
  filters: readonly Filter[],
  dialect: Dialect,
  lookup: ColumnLookup,
): PreparedStatement {
  const where = whereFragment(filters, dialect, lookup);
  return where === null ? { sql: "", params: [] } : compile(dialect, where);
}

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
  const selected = input.columns.filter((column) => lookup.kindOf(column) !== undefined);
  const projection =
    selected.length === 0
      ? sql`*`
      : sql.join(
          selected.map((column) => sql`${sql.identifier(column)}`),
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
