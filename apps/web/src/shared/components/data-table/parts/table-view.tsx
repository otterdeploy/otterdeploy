/**
 * The rows.
 *
 * This is the only part of the table whose cost grows with the data, so it is
 * the only part with performance decisions in it:
 *
 * - **Virtualized.** A feed can hold ten thousand rows after enough scrolling;
 *   the DOM holds about thirty. Rows are a fixed height, so offsets are pure
 *   arithmetic and nothing is measured after paint.
 * - **Memoized per row**, compared on the row's id AND its record. Every fetch
 *   rebuilds the core row model and hands back new `Row` objects for rows
 *   already on screen; comparing ids says "same row" — and comparing the record
 *   too is what makes a row the server changed re-render anyway.
 * - **Column widths as CSS variables**, computed once for the whole table.
 *   Calling `column.getSize()` per cell per render is the documented way to
 *   make a wide table janky.
 *
 * The compiler opt-out is load-bearing: the virtualizer mutates interior state
 * and notifies through its own re-render, so `getVirtualItems()` and
 * `getTotalSize()` would be cached on the (referentially stable) instance and
 * the body would commit at the first render's height forever.
 */
"use no memo";

import type { ReactTable } from "@tanstack/react-table";

import { memo, useCallback, useState } from "react";

import { flexRender, type Row, type RowData } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { DataTableFeatures } from "@/shared/components/data-table/features";

import { useFilterValue } from "@/shared/components/data-table/state/store";
import { cn } from "@/shared/lib/utils";

/** Fixed row heights, in px. Uniform rows are what keep the virtualizer exact. */
export const ROW_HEIGHT = { compact: 32, comfortable: 38 } as const;
export type Density = keyof typeof ROW_HEIGHT;

interface TableViewProps<TRow extends RowData> {
  table: ReactTable<DataTableFeatures, TRow>;
  rows: Row<DataTableFeatures, TRow>[];
  density: Density;
  /** Opens the detail sheet. `null` closes it. */
  onOpenRow: (rowId: string | null) => void;
  /** Extra classes per row — how live mode dims rows behind the tail. */
  rowClassName?: (row: Row<DataTableFeatures, TRow>) => string | undefined;
  /** Rendered under the last row: the load-more control, or the end of the feed. */
  footer?: React.ReactNode;
  onScrollEnd?: () => void;
}

/** A column with no size flexes; one with a size is pinned to it. */
function cellStyle(size: number | undefined, minSize: number | undefined) {
  if (size === undefined) {
    return { flex: "1 1 0%", minWidth: minSize ?? 80 };
  }
  return { width: size, minWidth: size, flexShrink: 0 };
}

export function DataTableView<TRow extends RowData>({
  table,
  rows,
  density,
  onOpenRow,
  rowClassName,
  footer,
  onScrollEnd,
}: TableViewProps<TRow>) {
  /**
   * The scroll element lives in STATE, not a ref: a table can mount inside a
   * tab panel that renders after this hook runs, and a plain ref populates
   * without re-rendering — so whether the virtualizer ever observed the element
   * came down to an unrelated render happening at the right moment. When it
   * lost that race it rendered the range for offset 0 forever.
   */
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const rowHeight = ROW_HEIGHT[density];

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowHeight,
    overscan: 12,
    // Keyed by row id, not index: a feed prepends rows in live mode, and index
    // keys would remap every rendered node to a different row on each arrival.
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      // Half a viewport of runway, so the next page is already arriving by the
      // time the reader reaches the bottom.
      if (el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight / 2) {
        onScrollEnd?.();
      }
    },
    [onScrollEnd],
  );

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={setScrollEl} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
      {/* A raw <table> in grid layout: the shadcn wrapper adds an overflow
          container between the scroll element and the rows, which turns the
          sticky header into a second scroll context and breaks it. */}
      <table className="grid w-full text-sm">
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
                    style={cellStyle(header.column.columnDef.size, header.column.columnDef.minSize)}
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
                        onDoubleClick={() => header.column.resetSize()}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none after:absolute after:inset-y-1.5 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-border"
                      />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        <tbody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <MemoRow
                key={row.id}
                row={row}
                start={item.start}
                height={rowHeight}
                selected={row.getIsSelected()}
                onOpenRow={onOpenRow}
                extraClassName={rowClassName?.(row)}
              />
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
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

interface RowProps<TRow extends RowData> {
  row: Row<DataTableFeatures, TRow>;
  start: number;
  height: number;
  /** Read off the row, but passed in so the memo can compare it. */
  selected: boolean;
  onOpenRow: (rowId: string | null) => void;
  extraClassName?: string;
}

function RowImpl<TRow extends RowData>({
  row,
  start,
  height,
  selected,
  onOpenRow,
  extraClassName,
}: RowProps<TRow>) {
  /**
   * Selects a BOOLEAN, not the open row's id, so the store bails out for every
   * row whose own state did not change. Selecting the id here would wake every
   * mounted row on every selection.
   */
  const isOpen = useFilterValue((values) => values.row === row.id);

  return (
    <tr
      id={row.id}
      tabIndex={0}
      data-open={isOpen ? "" : undefined}
      data-selected={selected ? "" : undefined}
      onClick={() => onOpenRow(isOpen ? null : row.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpenRow(isOpen ? null : row.id);
      }}
      style={{ transform: `translateY(${start}px)`, height }}
      className={cn(
        "absolute flex w-full cursor-pointer items-stretch border-b transition-colors",
        "hover:bg-muted/40 focus-visible:bg-muted/50 focus-visible:outline-none",
        "data-open:bg-muted/60 data-selected:bg-primary/5",
        extraClassName,
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          style={cellStyle(cell.column.columnDef.size, cell.column.columnDef.minSize)}
          className={cn(
            "flex min-w-0 items-center truncate px-2",
            cell.column.columnDef.meta?.cellClassName,
          )}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

/**
 * The comparator cannot be left to the compiler.
 *
 * Every `fetchNextPage` rebuilds the core row model, so each already-rendered
 * row arrives as a NEW object. Comparing `row.id` says "same row, same render";
 * comparing `row.original` too is what makes a row the server actually changed
 * re-render, so an edit never leaves a stale cell on screen.
 */
const MemoizedRow = memo(RowImpl, (prev, next) => {
  return (
    prev.row.id === next.row.id &&
    prev.row.original === next.row.original &&
    prev.selected === next.selected &&
    prev.start === next.start &&
    prev.height === next.height &&
    prev.extraClassName === next.extraClassName &&
    prev.onOpenRow === next.onOpenRow
  );
});

/**
 * `React.memo` erases the generic, so it is re-exposed through an overloaded
 * wrapper: callers keep the typed signature, the memoized component still
 * short-circuits. No assertion involved.
 */
function MemoRow<TRow extends RowData>(props: RowProps<TRow>): React.JSX.Element;
function MemoRow(props: RowProps<RowData>): React.JSX.Element {
  return <MemoizedRow {...props} />;
}
