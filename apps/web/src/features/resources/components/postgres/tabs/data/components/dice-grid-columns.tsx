/**
 * Column definitions for {@link DiceResultGrid}: the optional select-checkbox
 * and row-detail-chevron columns plus one editable short-text column per
 * result column. Split out so the grid component stays within the
 * per-function line budget.
 */

import type { CellValue, ColumnMeta } from "@otterdeploy/data-engine";
import type { ColumnDef } from "@tanstack/react-table";

import { displayText, tableKey } from "@otterdeploy/data-engine";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { cn } from "@/shared/lib/utils";

import type { ColumnVariant } from "../data/queries";

import { variantForKind } from "../data/use-database";
import { TypeLabel, shortTypeName } from "./type-label";

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

/**
 * A column header: what the column is called, what it holds, and what it means
 * structurally.
 *
 * The engine's own type name rides along at 10px because a data browser whose
 * headers say only `id` makes you open Structure to answer "is this an int8 or
 * a uuid" — a question you ask constantly while reading rows. The key and
 * arrow glyphs carry the same weight: a primary key and a foreign key are the
 * two facts that tell you how to READ a row, and they are cheap to show here
 * and expensive to go looking for.
 */
function ColumnHeader({ column }: { column: ColumnMeta }) {
  const role = column.isPrimaryKey ? "pk" : column.references ? "fk" : null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
      {role === null ? null : (
        <span
          aria-hidden
          title={
            role === "pk"
              ? "Primary key"
              : `References ${tableKey(column.references ?? { schema: "", name: "" })}.${column.references?.column ?? ""}`
          }
          className={cn(
            "shrink-0 font-mono text-[10px] leading-none",
            role === "pk" ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground/70",
          )}
        >
          {role === "pk" ? "⚿" : "→"}
        </span>
      )}
      {/* The NAME never shrinks; the type tag gives up all of its space
          first. Shrink weights don't cut it — flexbox scales them by basis,
          so a long name still lost to a short tag. */}
      <span className="shrink-0">{column.name}</span>
      <TypeLabel type={column.dataType} className="min-w-0 truncate opacity-70" />
    </span>
  );
}

/**
 * A column's starting width, from what it HOLDS rather than one number for
 * every column.
 *
 * A flat default gives a uuid the same 150px as a bool, which strangles the
 * value people most need to read whole (`server_fw7xwcm6mi…`) while padding
 * the ones that never fill it. The reference viewer keys width off the type
 * the same way. Values are for 12px mono ≈ 7.2px/char plus cell padding; the
 * user's own drag-resize overrides all of it.
 */
const KIND_WIDTHS: ReadonlyMap<string, number> = new Map([
  ["bool", 100],
  ["number", 120],
  ["bigint", 150],
  ["decimal", 150],
  ["date", 120],
  ["time", 110],
  ["instant", 200],
  ["bytes", 160],
  ["json", 260],
  ["array", 220],
  ["text", 220],
  ["opaque", 180],
]);

function columnWidthFor(column: ColumnMeta): number {
  const type = column.dataType.toLowerCase();
  const byContent = type.includes("uuid") ? 290 : (KIND_WIDTHS.get(column.kind) ?? 180);
  // The header must fit too: name at 12px mono, the SHORT type tag at 10px
  // (that is what renders), plus glyphs, gaps, padding and the sort chevron.
  const tag = shortTypeName(column.dataType).length;
  const headerNeed = Math.round(column.name.length * 7.3 + tag * 6.2 + 62);
  return Math.min(340, Math.max(90, byContent, headerNeed));
}

export function useDiceColumnDefs({
  columns,
  hiddenColumns,
  selectable,
}: {
  columns: readonly ColumnMeta[];
  hiddenColumns?: string[];
  selectable: boolean;
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
  const hidden = new Set(hiddenColumns ?? []);
  for (const column of columns) {
    if (hidden.has(column.name)) continue;
    // "boolean" renders as text (true/false words). DiceUI's checkbox variant
    // would replace the words with a checkbox, which cannot show NULL.
    const kindVariant = variantForKind(column.kind);
    const variant: ColumnVariant = kindVariant === "boolean" ? "short-text" : kindVariant;
    // An enum edits as a select over its OWN values — the engine already told
    // us the full set, and free text here is just a typo waiting for a 22P02.
    const cellOpts =
      column.enumValues !== null && column.enumValues.length > 0
        ? {
            variant: "select" as const,
            options: column.enumValues.map((v) => ({ label: v, value: v })),
          }
        : { variant };
    defs.push({
      id: column.name,
      // Read the typed cell, render its text. The accessor is what the grid
      // sorts, filters and copies by, so it must be the DISPLAY string —
      // returning the tagged object would show "[object Object]".
      accessorFn: (row) => cellText(row[column.name]),
      // A STRING header, with the decorated version in meta. A function here
      // flips the grid's "custom column" fast path, which drops the sort menu,
      // the resize handle, and — because the CELL branch keys off the header's
      // type — every cell's editor and truncation with it.
      header: column.name,
      size: columnWidthFor(column),
      meta: { label: column.name, labelNode: <ColumnHeader column={column} />, cell: cellOpts },
    });
  }
  return defs;
}
