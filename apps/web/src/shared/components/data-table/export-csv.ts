/**
 * The loaded rows as CSV, driven by the column declaration.
 *
 * Every visible-or-not column is exported, not just the visible ones: hiding a
 * column is a reading preference, and an export that silently dropped the
 * columns someone collapsed would be a different dataset than they think they
 * have. Filter-only declarations (the search box) are not columns and are
 * skipped.
 *
 * It exports what is LOADED. Exporting the whole filtered set would mean paging
 * a feed to its end behind a button that looks instant, so the honest offer is
 * the rows in hand — and the caller labels the button accordingly.
 */

import type { DataTableColumn } from "@/shared/components/data-table/schema/types";

/** RFC 4180: quote everything, double the quotes inside. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function readKey(row: unknown, key: string): unknown {
  if (typeof row !== "object" || row === null) return undefined;
  return Object.hasOwn(row, key) ? Reflect.get(row, key) : undefined;
}

export function toCsv<TRow>(
  rows: readonly TRow[],
  columns: readonly DataTableColumn<TRow>[],
): string {
  const exported = columns.filter((column) => !column.filterOnly);
  const header = exported.map((column) => cell(column.label)).join(",");
  const body = rows.map((row) =>
    exported
      .map((column) => cell(column.accessor ? column.accessor(row) : readKey(row, column.key)))
      .join(","),
  );
  return [header, ...body].join("\n");
}

/** Hand the browser a file. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
