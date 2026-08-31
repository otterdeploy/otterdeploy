/**
 * Column definitions for {@link DiceResultGrid}: the optional select-checkbox
 * and row-detail-chevron columns plus one editable short-text column per
 * result column. Split out so the grid component stays within the
 * per-function line budget.
 */

import type { CellValue, ColumnMeta } from "@otterdeploy/data-engine";
import type { ColumnDef } from "@tanstack/react-table";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { displayText } from "@otterdeploy/data-engine";

import { Checkbox } from "@/shared/components/ui/checkbox";

import type { ColumnVariant } from "../data/queries";

import { variantForKind } from "../data/use-database";

/**
 * One grid row, keyed by column name.
 *
 * Values are typed cells: `null` is SQL NULL, while `{ k: "text", v: "" }` is
 * the empty string. The predecessor could not tell those apart at all.
 *
 * The union with `string` is the TRANSIENT post-edit state. The DataGrid
 * commits an inline edit by patching the raw editor text onto the row
 * (`patch[columnId] = value` in use-data-grid), so between the keystroke and
 * the parse the cell holds text. `cellOf` collapses both cases for rendering,
 * and the grid parses it back against the column's kind before it is saved —
 * which is where an unparseable edit gets rejected rather than coerced.
 */
export type Row = Record<string, CellValue | string>;

/** Render either state of a cell. */
export function cellText(value: CellValue | string | undefined): string {
  if (typeof value === "string") return value;
  return displayText(value ?? null);
}

/** True only for a committed SQL NULL, never for post-edit text. */
export function isNullCell(value: CellValue | string | undefined): boolean {
  return value === null || value === undefined;
}

/**
 * A cell's committed value, ignoring any transient editor text.
 *
 * Used where a REAL `CellValue` is needed rather than something to render — the
 * before-side of a diff, or a primary key. Post-edit text becomes a `text` cell
 * as a last resort; callers that care about the column's true kind parse it
 * themselves with `parseCell`.
 */
export function cellOf(value: CellValue | string | undefined): CellValue {
  if (value === undefined) return null;
  return typeof value === "string" ? { k: "text", v: value } : value;
}

export function useDiceColumnDefs({
  columns,
  hiddenColumns,
  selectable,
  enableRowDetail,
  onOpenDetail,
}: {
  columns: readonly ColumnMeta[];
  hiddenColumns?: string[];
  selectable: boolean;
  enableRowDetail: boolean;
  onOpenDetail: (rowIndex: number) => void;
}): ColumnDef<Row>[] {
  const defs: ColumnDef<Row>[] = [];
  // Function header/cell → the grid flexRenders them; keyboard navigation
  // skips the "select" / "actions" column ids by design.
  if (selectable) {
    defs.push({
      id: "select",
      size: 44,
      enableSorting: false,
      enableResizing: false,
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows"
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
          onCheckedChange={(v) => table.toggleAllRowsSelected(Boolean(v))}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
        />
      ),
    });
  }
  if (enableRowDetail) {
    defs.push({
      id: "actions",
      size: 36,
      enableSorting: false,
      enableResizing: false,
      header: () => null,
      cell: ({ row }) => (
        <button
          type="button"
          aria-label="Open row detail"
          onClick={() => onOpenDetail(row.index)}
          className="flex size-full items-center justify-center text-muted-foreground/50 hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
        </button>
      ),
    });
  }
  const hidden = new Set(hiddenColumns ?? []);
  for (const column of columns) {
    if (hidden.has(column.name)) continue;
    // "boolean" renders as text (true/false words). DiceUI's checkbox variant
    // would replace the words with a checkbox, which cannot show NULL.
    const kindVariant = variantForKind(column.kind);
    const variant: ColumnVariant = kindVariant === "boolean" ? "short-text" : kindVariant;
    defs.push({
      id: column.name,
      // Read the typed cell, render its text. The accessor is what the grid
      // sorts, filters and copies by, so it must be the DISPLAY string —
      // returning the tagged object would show "[object Object]".
      accessorFn: (row) => cellText(row[column.name]),
      header: column.name,
      meta: { cell: { variant } },
    });
  }
  return defs;
}
