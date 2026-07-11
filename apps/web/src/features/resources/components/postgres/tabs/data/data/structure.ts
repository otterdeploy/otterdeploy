/**
 * Column-detail model for the Structure view and the Add-record modal — the
 * parsed shape of `structureSql` (./queries) results. Pure: the fetching hook
 * lives in ./use-database, this file only reshapes the grid rows.
 */

import { shortType } from "./queries";

export interface StructureColumn {
  name: string;
  /** Full information_schema data_type ("timestamp with time zone"). */
  dataType: string;
  /** Collapsed display type ("timestamp"). */
  displayType: string;
  nullable: boolean;
  /** Raw column_default expression ("now()", "nextval('…')"), null when none. */
  default: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  /** Referenced column for FK columns, null otherwise. */
  fkRef: { schema: string; table: string; column: string } | null;
  /** Identity / serial — the database generates the value ("auto"). */
  isAuto: boolean;
  /** No value needed from the user: nullable, defaulted, or auto-generated. */
  isRequired: boolean;
}

const t = (v: string | null | undefined) => v === "t";
const yes = (v: string | null | undefined) => v === "YES";

/** Parse one `structureSql` result grid into StructureColumns (column order:
 *  name, data_type, is_nullable, column_default, is_identity, is_pk, is_uq,
 *  ref_schema, ref_table, ref_column). */
export function parseStructureRows(rows: (string | null)[][]): StructureColumn[] {
  const out: StructureColumn[] = [];
  for (const r of rows) {
    const name = r[0];
    if (!name) continue;
    const dataType = r[1] ?? "";
    const nullable = yes(r[2]);
    const def = r[3] ?? null;
    const isAuto = yes(r[4]) || (def !== null && def.startsWith("nextval("));
    const refTable = r[8];
    const refColumn = r[9];
    out.push({
      name,
      dataType,
      displayType: shortType(dataType),
      nullable,
      default: def,
      isPrimaryKey: t(r[5]),
      isUnique: t(r[6]),
      fkRef:
        refTable && refColumn
          ? { schema: r[7] ?? "public", table: refTable, column: refColumn }
          : null,
      isAuto,
      isRequired: !nullable && def === null && !isAuto,
    });
  }
  return out;
}

/** Broad input-kind for the Add-record modal's per-column control. */
export type ColumnInputKind = "boolean" | "number" | "json" | "timestamp" | "text";

export function columnInputKind(dataType: string): ColumnInputKind {
  if (/bool/.test(dataType)) return "boolean";
  if (/int|numeric|real|double|decimal|money/.test(dataType)) return "number";
  if (/json/.test(dataType)) return "json";
  if (/timestamp|date|time/.test(dataType)) return "timestamp";
  return "text";
}
