/**
 * The row detail sheet.
 *
 * A table row is a summary; the sheet is the record. Three things make it an
 * instrument rather than a popup:
 *
 * - **The open row is in the URL**, so a single event is a link — the same
 *   reason the filters are.
 * - **↑ and ↓ move between rows** without closing it, which is how anyone
 *   actually reads a feed: open the first interesting row, then walk.
 * - **Focus returns to the row** it came from on close, so the keyboard does
 *   not dump the reader back at the top of the page.
 */

import type { RowData } from "@tanstack/react-table";

import { useEffect } from "react";

import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { DataTableColumn } from "@/shared/components/data-table/schema/types";

import { TextCell } from "@/shared/components/data-table/cells";
import { defaultDisplay } from "@/shared/components/data-table/schema/types";
import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { cn } from "@/shared/lib/utils";

export interface RowSheetProps<TRow extends RowData> {
  /** The record itself, or `undefined` when the open id is not loaded. */
  row: TRow | undefined;
  columns: readonly DataTableColumn<TRow>[];
  openRowId: string | null;
  onOpenRow: (rowId: string | null) => void;
  /** Neighbours, for ↑/↓. `null` at either end. */
  previousRowId: string | null;
  nextRowId: string | null;
  title: (row: TRow) => React.ReactNode;
  /** Extra content under the fields — related records, raw payloads, actions. */
  children?: React.ReactNode;
}

export function DataTableRowSheet<TRow extends RowData>({
  row,
  columns,
  openRowId,
  onOpenRow,
  previousRowId,
  nextRowId,
  title,
  children,
}: RowSheetProps<TRow>) {
  const isOpen = openRowId !== null;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A menu or a combobox inside the sheet owns its own arrow keys; stealing
      // them here would make every dropdown in the sheet change the row instead.
      if (document.activeElement?.closest('[role="menu"],[role="listbox"]')) return;
      if (event.key === "ArrowUp" && previousRowId) {
        event.preventDefault();
        onOpenRow(previousRowId);
      }
      if (event.key === "ArrowDown" && nextRowId) {
        event.preventDefault();
        onOpenRow(nextRowId);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, previousRowId, nextRowId, onOpenRow]);

  const close = () => {
    const element = openRowId ? document.getElementById(openRowId) : null;
    onOpenRow(null);
    // After the sheet unmounts, or the focus it is restoring lands nowhere.
    setTimeout(() => element?.focus(), 0);
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => (open ? undefined : close())}>
      <SheetContent
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md"
        showCloseButton={false}
      >
        <SheetHeader className="sticky top-0 z-10 gap-0 border-b bg-popover px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="min-w-0 truncate text-left text-sm">
              {row ? title(row) : "Row"}
            </SheetTitle>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous row"
                disabled={!previousRowId}
                onClick={() => previousRowId && onOpenRow(previousRowId)}
              >
                <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next row"
                disabled={!nextRowId}
                onClick={() => nextRowId && onOpenRow(nextRowId)}
              >
                <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={close}>
                Close
              </Button>
            </div>
          </div>
          <SheetDescription className="sr-only">
            Details for the selected row. Use the up and down arrow keys to move between rows.
          </SheetDescription>
        </SheetHeader>

        {row ? (
          <div className="divide-y">
            {columns
              .filter((column) => column.sheet !== false)
              .map((column) => (
                <SheetField key={column.key} column={column} row={row} />
              ))}
            {children}
          </div>
        ) : (
          // The id in the URL names a row this page has not loaded — an honest
          // statement, not an empty panel that looks broken.
          <p className="p-4 text-sm text-muted-foreground">
            That row is not in the current results.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetField<TRow extends RowData>({
  column,
  row,
}: {
  column: DataTableColumn<TRow>;
  row: TRow;
}) {
  const override = column.sheet === false ? undefined : column.sheet;
  const value = column.accessor
    ? column.accessor(row)
    : Object.hasOwn(row, column.key)
      ? Reflect.get(row, column.key)
      : undefined;

  const display = column.display ?? defaultDisplay(column.kind);
  const isMono = display.type === "code" || display.type === "number";

  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr] items-baseline gap-3 px-4 py-2.5">
      <span className="truncate text-xs text-muted-foreground">
        {override?.label ?? column.label}
      </span>
      <div className={cn("min-w-0 text-[13px]", isMono && "font-mono")}>
        {override?.render ? (
          override.render(row)
        ) : column.cell ? (
          column.cell({ value, row })
        ) : (
          // The sheet is where a value stops being a preview: it wraps rather
          // than truncating, because this is the copy someone is reading.
          <span className="block break-words whitespace-pre-wrap">
            <TextCell value={value} />
          </span>
        )}
      </div>
    </div>
  );
}
