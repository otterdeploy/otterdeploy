/**
 * Data-viewer query layer — every read-only SQL string this feature sends to
 * `database.query`, in one place. Builders quote identifiers (double quotes
 * doubled) and escape values (single quotes doubled); the query path itself is
 * read-only. Pair these builders with the hooks in `./use-database`.
 */

import type { FkTarget } from "@/shared/components/data-grid/types";

/** A schema-qualified table reference (the unit the browser navigates by). */
export type TableRef = { schema: string; name: string };

/** Grid cell rendering variant, derived from a column's Postgres data_type. */
export type ColumnVariant = "short-text" | "date" | "number" | "boolean";

/** Largest row count the SQL console returns in a single run. */
export const SQL_RESULT_CAP = 1000;

/** Escape a single-quoted SQL string literal. */
const escLiteral = (v: string) => v.replace(/'/g, "''");

/** Quote a SQL identifier (embedded double quotes doubled). */
const quoteIdent = (c: string) => `"${c.replace(/"/g, '""')}"`;

/** Map an information_schema.data_type to a grid cell variant. */
export function pgTypeToVariant(type: string): ColumnVariant {
  if (/bool/.test(type)) return "boolean";
  if (/timestamp|date/.test(type)) return "date";
  if (/int|numeric|real|double|decimal|money/.test(type)) return "number";
  return "short-text";
}

/** Collapse Postgres' verbose `information_schema.data_type` to a short label. */
export function shortType(type: string): string {
  return type
    .replace(/ with time zone$/, "")
    .replace(/ without time zone$/, "")
    .replace(/^character varying$/, "varchar")
    .replace(/^character$/, "char")
    .replace(/^double precision$/, "double");
}

// ─── SQL builders ───────────────────────────────────────────────────────────

/** `SELECT *` page for the table browser — `where` is the pre-built ` WHERE …`
 *  suffix from `buildWhere`, `limit` is typically pageSize + 1 (next-page probe). */
export function browseRowsSql(
  table: TableRef,
  where: string,
  limit: number,
  offset: number,
): string {
  return `SELECT * FROM ${quoteIdent(table.schema)}.${quoteIdent(table.name)}${where} LIMIT ${limit} OFFSET ${offset}`;
}

/** Column name + type for a table → cell variants + editor autocomplete. */
export function columnTypesSql(table: TableRef): string {
  return `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '${escLiteral(table.schema)}' AND table_name = '${escLiteral(table.name)}' ORDER BY ordinal_position`;
}

/** Foreign keys for a table, so FK cells can link to the referenced row. */
export function foreignKeysSql(table: TableRef): string {
  return `SELECT kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name AS ref_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '${escLiteral(table.schema)}' AND tc.table_name = '${escLiteral(table.name)}'`;
}

/** Columns + a PK flag for the schema explorer's expandable table row. */
export function tableColumnsSql(table: TableRef): string {
  return `SELECT c.column_name, c.data_type,
       CASE WHEN pk.column_name IS NOT NULL THEN 't' ELSE 'f' END AS is_pk
  FROM information_schema.columns c
  LEFT JOIN (
    SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = '${escLiteral(table.schema)}'
       AND tc.table_name = '${escLiteral(table.name)}'
  ) pk ON pk.column_name = c.column_name
 WHERE c.table_schema = '${escLiteral(table.schema)}' AND c.table_name = '${escLiteral(table.name)}'
 ORDER BY c.ordinal_position`;
}

/** A single referenced row, for the FK popover. */
export function referencedRowSql(fk: FkTarget, value: string): string {
  return `SELECT * FROM ${quoteIdent(fk.schema)}.${quoteIdent(fk.table)} WHERE ${quoteIdent(fk.column)} = '${escLiteral(value)}' LIMIT 1`;
}

/** Primary-key column names for a table, in key order — the write path needs
 *  them to target a row (editing is disabled when a table has none). */
export function primaryKeysSql(table: TableRef): string {
  return `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = '${escLiteral(table.schema)}' AND tc.table_name = '${escLiteral(table.name)}'
    ORDER BY kcu.ordinal_position`;
}
