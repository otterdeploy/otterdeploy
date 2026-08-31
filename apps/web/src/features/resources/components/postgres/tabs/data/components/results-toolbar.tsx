/**
 * Sub-toolbar for {@link ResultsPanel}: the owner's `leftSlot`, the grid/JSON
 * view toggle, and the export menu. Exports (CSV / JSON, all or selected rows)
 * always carry EVERY column. Column hiding only trims the grid.
 */

import type { CellValue, ColumnMeta } from "@otterdeploy/data-engine";

import { Download01Icon, SourceCodeIcon, Table01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { displayText } from "@otterdeploy/data-engine";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";

export type ResultView = "grid" | "json";

function download(blobPart: string, mime: string, filename: string) {
  const blob = new Blob([blobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * CSV, with NULL and the empty string kept apart.
 *
 * RFC 4180 has no NULL, so the convention every loader understands is: an
 * unquoted empty field is NULL, a quoted empty field (`""`) is the empty
 * string. The predecessor emitted both as nothing, which meant a round trip
 * through export/import silently turned every empty string into a NULL.
 */
function toCsv(columns: readonly ColumnMeta[], rows: readonly CellValue[][]): string {
  const escHeader = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const escCell = (cell: CellValue | undefined) => {
    if (cell === null || cell === undefined) return "";
    const text = displayText(cell);
    if (text === "") return '""';
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.map((c) => escHeader(c.name)).join(","),
    ...rows.map((r) => r.map(escCell).join(",")),
  ].join("\n");
}

/**
 * JSON, keeping each value's real type.
 *
 * A `jsonb` column exports as an object, a boolean as a boolean, and an exact
 * `int8` as a string so no digit is lost — rather than everything arriving as
 * the text psql happened to print.
 */
function toJson(columns: readonly ColumnMeta[], rows: readonly CellValue[][]): string {
  return JSON.stringify(resultRowsAsJson(columns, rows), null, 2);
}

/** The JSON-native form of a non-json cell. */
function jsonScalar(cell: Exclude<CellValue, null>): unknown {
  if (cell.k === "bool" || cell.k === "number") return cell.v;
  if (cell.k === "json") return cell.v;
  if (cell.k === "array") return cell.v.map((entry) => (entry === null ? null : jsonScalar(entry)));
  // bigint / decimal stay strings so precision survives; everything else is
  // already text.
  return displayText(cell);
}

/** Convert a typed result grid without flattening JSON, numbers, or booleans to text. */
export function resultRowsAsJson(
  columns: readonly ColumnMeta[],
  rows: readonly CellValue[][],
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const object: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      const cell = row[index] ?? null;
      object[column.name] = cell === null ? null : jsonScalar(cell);
    });
    return object;
  });
}

export function ResultsToolbar({
  columns,
  rows,
  view,
  onViewChange,
  canExport,
  exportName,
  selectable,
  selectedRows,
  leftSlot,
}: {
  columns: readonly ColumnMeta[];
  rows: readonly CellValue[][];
  view: ResultView;
  onViewChange: (v: ResultView) => void;
  canExport: boolean;
  exportName: string;
  selectable: boolean;
  selectedRows?: number[];
  leftSlot?: React.ReactNode;
}) {
  const selectedCount = selectedRows?.length ?? 0;
  const rowsFor = (selection: boolean) =>
    selection
      ? (selectedRows ?? []).map((i) => rows[i]).filter((r): r is CellValue[] => r !== undefined)
      : rows;
  const exportAs = (format: "csv" | "json", selection: boolean) => {
    const subset = rowsFor(selection);
    if (format === "csv")
      download(toCsv(columns, subset), "text/csv;charset=utf-8;", `${exportName}.csv`);
    else download(toJson(columns, subset), "application/json;charset=utf-8;", `${exportName}.json`);
  };

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2">
      <div className="flex min-w-0 items-center gap-2">{leftSlot}</div>
      <div className="flex items-center gap-1.5">
        <ToggleGroup
          size="sm"
          value={[view]}
          onValueChange={([v]) => {
            if (v === "grid" || v === "json") onViewChange(v);
          }}
          className="gap-0.5"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view" className="h-6 px-1.5">
            <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem value="json" aria-label="JSON view" className="h-6 px-1.5">
            <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} className="size-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" disabled={!canExport} aria-label="Export" />
            }
          >
            <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportAs("csv", false)}>
              Export all to .csv
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportAs("json", false)}>
              Export all to .json
            </DropdownMenuItem>
            {selectable ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={selectedCount === 0}
                  onClick={() => exportAs("csv", true)}
                >
                  Export selected to .csv{selectedCount ? ` (${selectedCount})` : ""}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={selectedCount === 0}
                  onClick={() => exportAs("json", true)}
                >
                  Export selected to .json{selectedCount ? ` (${selectedCount})` : ""}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
