/**
 * The header row: labels, the sort control, and the resize handles.
 *
 * Its own module because it is where the table's SIZING lives. Column widths
 * are written once per render as CSS custom properties on the `<table>`
 * element and referred to by name from every cell, so dragging a column edge
 * changes one variable on one element rather than re-rendering ten thousand
 * cells.
 *
 * The compiler opt-out is the same one the row renderer needs: the table
 * instance is referentially stable by design, so `getHeaderGroups()` and
 * `state.columnSizing` read off it would be cached on that identity and the
 * header would keep the widths of its first render through every drag.
 */
"use no memo";

import type { ReactTable, RowData } from "@tanstack/react-table";

import { flexRender } from "@tanstack/react-table";

import type { DataTableFeatures } from "@/shared/components/data-table/features";

import { cn } from "@/shared/lib/utils";

/**
 * Widths, as CSS custom properties.
 *
 * Every column's width is written once per render onto the `<table>` element,
 * and each cell refers to it by name. Two things fall out of that:
 *
 * - **A drag re-renders nothing.** Resizing changes one variable on one
 *   element; the memoized rows are not touched, so a resize is smooth at any
 *   row count. Reading `column.getSize()` per cell — the obvious way — is the
 *   documented way to make a wide table janky.
 * - **The cell style is constant per column**, so it never invalidates a memo.
 *
 * `--grow` carries the flex behaviour for the same reason: whether a column
 * absorbs leftover width is a declaration, not per-cell state.
 */
export type SizeVars = React.CSSProperties & Record<string, string>;

/** Narrow enough for an id or a short code, wide enough not to clip a label. */
const DEFAULT_MIN_WIDTH = 80;

/** One column's contribution to the width variables. */
export interface ColumnWidth {
  id: string;
  /** The width the schema declared, if it declared one. */
  declared: number | undefined;
  /** The width the reader dragged it to, if they dragged it. */
  resized: number | undefined;
  min: number;
}

/**
 * The width rule, as data.
 *
 * A column that declares no width and has not been dragged absorbs leftover
 * space, growing from its minimum; every other column is exactly as wide as it
 * was declared or dragged to be. Kept pure so the rule can be read and tested
 * without a table instance.
 */
export function widthVars(columns: readonly ColumnWidth[]): SizeVars {
  const vars: SizeVars = {};
  for (const { id, declared, resized, min } of columns) {
    const flexible = declared === undefined && resized === undefined;
    vars[`--col-${id}-size`] = `${resized ?? declared ?? min}px`;
    vars[`--col-${id}-min`] = `${min}px`;
    vars[`--col-${id}-grow`] = flexible ? "1" : "0";
  }
  return vars;
}

export function sizeVarsOf<TRow extends RowData>(
  table: ReactTable<DataTableFeatures, TRow>,
): SizeVars {
  return widthVars(
    table.getFlatHeaders().map((header) => ({
      id: header.column.id,
      declared: header.column.columnDef.size,
      resized: table.state.columnSizing?.[header.column.id],
      min: header.column.columnDef.minSize ?? DEFAULT_MIN_WIDTH,
    })),
  );
}

/** The style every cell in a column gets — the same object shape either way. */
export function cellStyle(columnId: string): React.CSSProperties {
  return {
    width: `var(--col-${columnId}-size)`,
    minWidth: `var(--col-${columnId}-min)`,
    flexGrow: `var(--col-${columnId}-grow)`,
    flexShrink: 0,
  };
}

export function DataTableHead<TRow extends RowData>({
  table,
}: {
  table: ReactTable<DataTableFeatures, TRow>;
}) {
  return (
    <thead className="sticky top-0 z-10 grid bg-background">
      {table.getHeaderGroups().map((headerGroup) => (
        <tr key={headerGroup.id} className="flex w-full border-b">
          {headerGroup.headers.map((header) => {
            const sorted = header.column.getIsSorted();
            const canSort = header.column.getCanSort();
            return (
              <th
                key={header.id}
                aria-sort={
                  sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                }
                style={cellStyle(header.column.id)}
                className={cn(
                  "relative flex h-9 items-center px-2 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase",
                  header.column.columnDef.meta?.headerClassName,
                )}
              >
                {header.isPlaceholder ? null : canSort ? (
                  <button
                    type="button"
                    onClick={header.column.getToggleSortingHandler()}
                    className="flex items-center gap-1 truncate rounded-sm transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className="truncate">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                    <SortMark direction={sorted} />
                  </button>
                ) : (
                  <span className="truncate">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </span>
                )}
                {header.column.getCanResize() ? (
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${header.column.id}`}
                    data-resizing={header.column.getIsResizing() ? "" : undefined}
                    onDoubleClick={() => header.column.resetSize()}
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none after:absolute after:inset-y-1.5 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-border data-resizing:after:inset-y-0 data-resizing:after:bg-primary"
                  />
                ) : null}
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );
}

function SortMark({ direction }: { direction: false | "asc" | "desc" }) {
  if (!direction) {
    // A reserved, empty slot: without it, sorting a column shifts its header
    // label sideways by the width of the mark.
    return <span aria-hidden className="w-2.5 shrink-0" />;
  }
  return (
    <span aria-hidden className="w-2.5 shrink-0 text-center text-foreground">
      {direction === "asc" ? "↑" : "↓"}
    </span>
  );
}
