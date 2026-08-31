/**
 * Serialize grid rows to the clipboard formats the context menu offers.
 *
 * Works from the TYPED cells, not the display strings, so SQL NULL survives
 * as `NULL` / JSON `null` instead of collapsing into an empty string, and SQL
 * emits numbers and booleans unquoted. This is what makes "Copy as SQL"
 * pasteable rather than merely SQL-shaped.
 */
import type { CellValue, ColumnMeta } from "@otterdeploy/data-engine";

import type { CopyRowsFormat } from "@/shared/components/data-grid/types";

import type { Row } from "./dice-grid-columns";

import { cellOf, cellText, isNullCell } from "./dice-grid-columns";

export type { CopyRowsFormat };

export function serializeRows(
  format: CopyRowsFormat,
  input: { tableName: string; columns: readonly ColumnMeta[]; rows: readonly Row[] },
): string {
  const names = input.columns.map((c) => c.name);
  switch (format) {
    case "json": {
      const objects = input.rows.map((row) => {
        const out: Record<string, string | null> = {};
        for (const name of names) out[name] = isNullCell(row[name]) ? null : cellText(row[name]);
        return out;
      });
      return JSON.stringify(objects.length === 1 ? objects[0] : objects, null, 2);
    }
    case "csv":
      return delimited(names, input.rows, ",", csvField);
    case "tsv":
      return delimited(names, input.rows, "\t", (v) => v.replace(/[\t\n]/g, " "));
    case "markdown": {
      const header = `| ${names.join(" | ")} |`;
      const rule = `| ${names.map(() => "---").join(" | ")} |`;
      const body = input.rows.map(
        (row) => `| ${names.map((n) => cellText(row[n]).replace(/\|/g, "\\|")).join(" | ")} |`,
      );
      return [header, rule, ...body].join("\n");
    }
    case "sql": {
      const cols = names.map(quoteIdent).join(", ");
      const values = input.rows
        .map((row) => `(${names.map((n) => sqlLiteral(cellOf(row[n]))).join(", ")})`)
        .join(",\n  ");
      return `INSERT INTO ${quoteIdent(input.tableName)} (${cols})\nVALUES\n  ${values};`;
    }
  }
}

function delimited(
  names: readonly string[],
  rows: readonly Row[],
  sep: string,
  escape: (v: string) => string,
): string {
  const lines = [names.map(escape).join(sep)];
  for (const row of rows) lines.push(names.map((n) => escape(cellText(row[n]))).join(sep));
  return lines.join("\n");
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A pasteable SQL literal for a typed cell. */
function sqlLiteral(cell: CellValue): string {
  if (cell === null) return "NULL";
  switch (cell.k) {
    case "number":
      return String(cell.v);
    case "bigint":
    case "decimal":
      return cell.v;
    case "bool":
      return cell.v ? "TRUE" : "FALSE";
    default:
      return `'${cellText(cell).replace(/'/g, "''")}'`;
  }
}
