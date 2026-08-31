/**
 * The Structure view's column model, DERIVED from introspected `ColumnMeta`.
 *
 * This used to parse a hand-written `structureSql` result — ten positional
 * columns read out of a `(string | null)[][]` by index, with `t`/`YES` string
 * sentinels for booleans. The SQL is gone (it lives once, per dialect, in
 * `@otterdeploy/data-engine`) and so is the parsing; what remains is the small
 * amount of PRESENTATION the structure table and the add-record dialog need on
 * top of the raw metadata.
 */
import type { ColumnMeta } from "@otterdeploy/data-engine";

import { shortType } from "./queries";

export interface StructureColumn {
  name: string;
  /** Full engine type name ("timestamp with time zone"). */
  dataType: string;
  /** Collapsed display type ("timestamp"). */
  displayType: string;
  nullable: boolean;
  /** Raw default expression ("now()", "nextval('…')"), null when none. */
  default: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  /** Referenced column for FK columns, null otherwise. */
  fkRef: { schema: string; table: string; column: string } | null;
  /** Identity / serial / generated: the database supplies the value. */
  isAuto: boolean;
  /** The user MUST supply a value: not nullable, not defaulted, not generated. */
  isRequired: boolean;
  /** Allowed values, when the column is an enum. */
  enumValues: string[] | null;
}

function toStructureColumn(column: ColumnMeta): StructureColumn {
  // `isGenerated` already covers identity, generated-always and serial's
  // `nextval(...)` default — the dialect decides, so this no longer has to
  // sniff the default expression for "nextval(" the way the parser did.
  const isAuto = column.isGenerated;
  return {
    name: column.name,
    dataType: column.dataType,
    displayType: shortType(column.dataType),
    nullable: column.nullable,
    default: column.defaultExpr,
    isPrimaryKey: column.isPrimaryKey,
    isUnique: column.isUnique,
    fkRef: column.references
      ? {
          schema: column.references.schema,
          table: column.references.name,
          column: column.references.column,
        }
      : null,
    isAuto,
    isRequired: !column.nullable && column.defaultExpr === null && !isAuto,
    enumValues: column.enumValues,
  };
}

export function toStructureColumns(columns: readonly ColumnMeta[]): StructureColumn[] {
  return columns.map(toStructureColumn);
}

/**
 * Which input the add-record dialog should render for a column.
 *
 * Reads the introspected cell KIND rather than regexing the type name, so a
 * `numeric` gets a number input on every engine instead of only where the
 * type happened to be spelled the way a regex expected.
 */
export type ColumnInputKind = "boolean" | "number" | "date" | "json" | "enum" | "text";

export function columnInputKind(
  column: StructureColumn,
  kind: ColumnMeta["kind"],
): ColumnInputKind {
  if (column.enumValues && column.enumValues.length > 0) return "enum";
  switch (kind) {
    case "bool":
      return "boolean";
    case "number":
    case "bigint":
    case "decimal":
      return "number";
    case "instant":
    case "datetime":
    case "date":
    case "time":
      return "date";
    case "json":
      return "json";
    default:
      return "text";
  }
}
