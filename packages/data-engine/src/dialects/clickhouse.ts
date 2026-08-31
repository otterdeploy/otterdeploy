import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * ClickHouse dialect.
 *
 * Read-mostly by design: it has no interactive transaction, and a row-level
 * UPDATE is an asynchronous `ALTER TABLE … UPDATE` mutation, not a statement
 * that returns when the row has changed. So `supportsTransactions` is false and
 * the workbench degrades the drafts bar to read-only for this dialect rather
 * than offering a commit it cannot honour. Browsing, filtering, sorting, the
 * SQL runner and every introspection surface work exactly as elsewhere.
 */
import type { Dialect, SqlCompiler } from "../dialect";
import type { CellKind } from "../value";

/** Unwrap `Nullable(T)`, `LowCardinality(T)`, `SimpleAggregateFunction(any, T)`. */
function unwrap(dataType: string): string {
  let t = dataType.trim();
  for (let depth = 0; depth < 8; depth++) {
    const m = /^(Nullable|LowCardinality)\((.*)\)$/s.exec(t);
    if (!m || m[2] === undefined) break;
    t = m[2].trim();
  }
  return t;
}

/**
 * Ordered predicates rather than a name table: ClickHouse types are
 * parameterised (`DateTime64(3)`, `FixedString(16)`, `Decimal(10, 2)`), so most
 * of the matching is by prefix or pattern and a plain map would not reach them.
 * First match wins, so the more specific patterns come first.
 */
const CLICKHOUSE_TYPE_RULES: ReadonlyArray<readonly [RegExp, CellKind]> = [
  [/^array\(/, "array"],
  [/^(map|tuple|nested|object)\(/, "json"],
  [/^json$/, "json"],
  [/^decimal/, "decimal"],
  // datetime64 before datetime: the prefix would otherwise swallow it.
  [/^datetime/, "instant"],
  [/^date(32)?$/, "date"],
  [/^(string|fixedstring\(|uuid$|ipv4$|ipv6$|enum)/, "text"],
  [/^bool(ean)?$/, "bool"],
  // Int64 and wider exceed Number.MAX_SAFE_INTEGER; narrower is safe.
  [/^u?int(64|128|256)$/, "bigint"],
  [/^u?int(8|16|32)$/, "number"],
  [/^float(32|64)$/, "number"],
];

export function classifyClickhouseType(dataType: string): CellKind {
  const lower = unwrap(dataType).toLowerCase();
  const hit = CLICKHOUSE_TYPE_RULES.find(([pattern]) => pattern.test(lower));
  return hit?.[1] ?? "opaque";
}

const SYSTEM_DATABASES = `('system', 'INFORMATION_SCHEMA', 'information_schema')`;

/**
 * Compile-only. ClickHouse quotes identifiers with backticks like MySQL but
 * numbers parameters like Postgres does not; it uses named `{p:Type}` binding.
 * Drizzle has no ClickHouse dialect. The Postgres compiler is used deliberately
 * rather than by omission: ClickHouse accepts double-quoted identifiers and the
 * positional parameter form, which is what this produces.
 */
let compiler: SqlCompiler | null = null;

export const clickhouseDialect: Dialect = {
  id: "clickhouse",
  engines: ["clickhouse"],
  // A ClickHouse "database" is the only namespace; it maps onto `schema`.
  supportsSchemas: true,
  supportsTransactions: false,
  defaultSchema: "default",

  compiler: () => (compiler ??= new PgDialect()),

  castToText: (expr) => sql`toString(${expr})`,
  caseInsensitiveLike: (expr, pattern, negate) =>
    negate
      ? sql`positionCaseInsensitive(${expr}, ${pattern}) = 0`
      : sql`positionCaseInsensitive(${expr}, ${pattern}) > 0`,
  orderByTerm: (column, direction, nulls) => {
    const dir = direction === "asc" ? sql`ASC` : sql`DESC`;
    if (nulls === null) return sql`${column} ${dir}`;
    return nulls === "first" ? sql`${column} ${dir} NULLS FIRST` : sql`${column} ${dir} NULLS LAST`;
  },

  // ClickHouse's `readonly` setting is per-user or per-query over HTTP, not a
  // wire startup parameter. Read-only must come from a readonly=1 user.
  readOnlyConnectionParams: () => null,
  classifyType: classifyClickhouseType,

  introspection: {
    schemas: `
      SELECT name AS schema FROM system.databases
      WHERE name NOT IN ${SYSTEM_DATABASES} ORDER BY name
    `,
    tables: `
      SELECT database AS schema, name,
             multiIf(engine = 'View', 'view',
                     engine = 'MaterializedView', 'materialized_view', 'table') AS kind,
             toInt64(total_rows)  AS estimated_rows,
             toInt64(total_bytes) AS size_bytes,
             comment
      FROM system.tables
      WHERE database NOT IN ${SYSTEM_DATABASES}
      ORDER BY database, name
    `,
    columns: `
      SELECT database AS schema, table AS table_name, name,
             type AS data_type,
             startsWith(type, 'Nullable(') AS nullable,
             position,
             default_expression AS default_expr,
             is_in_primary_key  AS is_primary_key,
             (default_kind = 'MATERIALIZED' OR default_kind = 'ALIAS') AS is_generated,
             NULL AS ref_schema, NULL AS ref_table, NULL AS ref_column,
             comment
      FROM system.columns
      WHERE database NOT IN ${SYSTEM_DATABASES}
      ORDER BY database, table, position
    `,
    // ClickHouse has skip-indexes rather than b-trees; the sorting key is the
    // closest thing to a primary index and is what actually governs a scan.
    indexes: `
      SELECT database AS schema, table AS table_name, name,
             0 AS is_unique, 0 AS is_primary,
             expr AS definition,
             toInt64(data_compressed_bytes) AS size_bytes,
             expr AS columns
      FROM system.data_skipping_indices
      WHERE database NOT IN ${SYSTEM_DATABASES}
      ORDER BY database, table, name
    `,
    // No constraint catalog worth surfacing: ClickHouse CHECK constraints are
    // per-table DDL text, and there are no foreign keys at all.
    constraints: `
      SELECT database AS schema, table AS table_name, name,
             'check' AS type, expr AS definition,
             NULL AS ref_schema, NULL AS ref_table, '' AS columns
      FROM system.constraints
      WHERE database NOT IN ${SYSTEM_DATABASES}
      ORDER BY database, table, name
    `,
    enums: null,
  },
};
