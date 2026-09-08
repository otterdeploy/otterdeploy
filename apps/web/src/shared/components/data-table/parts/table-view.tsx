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

import { ROW_HEIGHT, type Density } from "@/shared/components/data-table/parts/density";
import {
  cellStyle,
  DataTableHead,
  sizeVarsOf,
} from "@/shared/components/data-table/parts/table-header";
import { useRowNavigation } from "@/shared/components/data-table/parts/use-row-navigation";
import { useFilterValue } from "@/shared/components/data-table/state/store";
import { cn } from "@/shared/lib/utils";

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

  const scrollToIndex = useCallback(
    // `auto` keeps a row that is already visible where it is, so walking with
    // the arrows does not jerk the viewport under the reader on every step.
    (index: number) => virtualizer.scrollToIndex(index, { align: "auto" }),
    [virtualizer],
  );
  const nav = useRowNavigation({ count: rows.length, scrollEl, scrollToIndex });

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
      {/* The keyboard cursor listens on the TABLE, not the scroll container:
          row keydowns bubble here, and the element already carries a role. */}
      <table onKeyDown={nav.onKeyDown} style={sizeVarsOf(table)} className="grid w-full text-sm">
        <DataTableHead table={table} />

        <tbody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <MemoRow
                key={row.id}
                row={row}
                index={item.index}
                start={item.start}
                height={rowHeight}
                selected={row.getIsSelected()}
                active={nav.activeIndex === item.index}
                tabbable={nav.isTabbable(item.index)}
                onFocusRow={nav.onRowFocus}
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

interface RowProps<TRow extends RowData> {
  row: Row<DataTableFeatures, TRow>;
  /** Position in the feed — what the keyboard cursor addresses rows by. */
  index: number;
  start: number;
  height: number;
  /** Read off the row, but passed in so the memo can compare it. */
  selected: boolean;
  /** The keyboard cursor is on this row. */
  active: boolean;
  /** The one row in the tab order (roving tabindex). */
  tabbable: boolean;
  onFocusRow: (index: number) => void;
  onOpenRow: (rowId: string | null) => void;
  extraClassName?: string;
}

function RowImpl<TRow extends RowData>({
  row,
  index,
  start,
  height,
  selected,
  active,
  tabbable,
  onFocusRow,
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
      data-row-index={index}
      tabIndex={tabbable ? 0 : -1}
      data-open={isOpen ? "" : undefined}
      data-selected={selected ? "" : undefined}
      data-active={active ? "" : undefined}
      onFocus={() => onFocusRow(index)}
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
        // The keyboard cursor, as a rail rather than a fill: it has to read as
        // "you are here" even on a row that is also open, selected or dimmed.
        "data-active:before:absolute data-active:before:inset-y-0 data-active:before:left-0",
        "data-active:before:w-0.5 data-active:before:bg-primary",
        extraClassName,
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          style={cellStyle(cell.column.id)}
          className={cn(
            "flex min-w-0 items-center truncate px-3",
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
    prev.index === next.index &&
    prev.selected === next.selected &&
    prev.active === next.active &&
    prev.tabbable === next.tabbable &&
    prev.onFocusRow === next.onFocusRow &&
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
