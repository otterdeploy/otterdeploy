/**
 * What is left of the data viewer's query layer: presentation helpers only.
 *
 * This file used to hold every SQL string the BROWSER sent to
 * `database.query` — `browseRowsSql`, `columnTypesSql`, `foreignKeysSql`,
 * `tableColumnsSql`, `structureSql`, `primaryKeysSql`, `referencedRowSql` — with
 * its own `quoteIdent` and `escLiteral`. All of it duplicated catalog SQL and
 * quoting that now live once, per dialect, in `@otterdeploy/data-engine`, and
 * all of it meant the client was authoring statements for a database it could
 * not see the shape of.
 *
 * The client no longer sends SQL for anything except the explicit runner.
 */

/** A schema-qualified table reference (the unit the browser navigates by). */
export type { TableRef } from "@otterdeploy/data-engine";

/**
 * Grid cell rendering variant.
 *
 * A rendering concern of the shared DataGrid, and deliberately NOT the same
 * thing as a `CellKind`: the kind is what the database said, the variant is how
 * the grid draws it. Derived from the kind by `variantForKind` in
 * `./use-database`, never re-sniffed from a type name.
 */
export type ColumnVariant = "short-text" | "date" | "number" | "boolean";

/** Largest row count the SQL console returns in a single run. */
export const SQL_RESULT_CAP = 1000;

/**
 * Collapse a verbose engine type name to a short column-header label.
 *
 * Postgres reports `timestamp with time zone`; a 120px header shows
 * `timestamp`. Purely cosmetic — `ColumnMeta.dataType` keeps the full name for
 * the row-detail panel and the structure view.
 */
export function shortType(type: string): string {
  return type
    .replace(/ with time zone$/, "")
    .replace(/ without time zone$/, "")
    .replace(/^character varying$/, "varchar")
    .replace(/^character$/, "char")
    .replace(/^double precision$/, "double");
}
