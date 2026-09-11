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

import { CopyButton, copyableText } from "@/shared/components/data-table/parts/copy-value";
import { renderDisplay } from "@/shared/components/data-table/schema/columns";
import { columnValue } from "@/shared/components/data-table/schema/read-value";
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
              {/* The whole record, for a support thread or an issue: the
                  fields below are a rendering, and what someone pastes
                  elsewhere should be the record itself. */}
              {row === undefined ? null : (
                <CopyButton
                  value={JSON.stringify(row, null, 2)}
                  label="this row as JSON"
                  className="size-8"
                />
              )}
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
              .filter((column) => column.sheet !== false && !column.filterOnly)
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

/**
 * One field, in one of two layouts chosen by what the value IS.
 *
 * A scalar keeps the label/value/copy row: the fixed label column is what lets
 * a reader run down twenty fields looking for one. A BLOCK — a raw JSON line,
 * a table of request headers — cannot use it. Squeezed into the value column it
 * gets ~180px of a 360px sheet, and `items-baseline` pins its label to the
 * baseline of a 140px-tall block, so the label floats in the middle of nothing
 * and the row reads as broken.
 */
function SheetField<TRow extends RowData>({
  column,
  row,
}: {
  column: DataTableColumn<TRow>;
  row: TRow;
}) {
  const override = column.sheet === false ? undefined : column.sheet;
  const label = override?.label ?? column.label;
  const value = columnValue(column, row);
  const display = column.display ?? defaultDisplay(column.kind);
  const body = (
    <div
      className={cn(
        "min-w-0 text-[13px]",
        (display.type === "code" || display.type === "number") && "font-mono",
      )}
    >
      {override?.render ? (
        override.render(row)
      ) : column.cell ? (
        column.cell({ value, row })
      ) : (
        // The sheet is where a value stops being a preview: it wraps rather
        // than truncating, because this is the copy someone is reading. Through
        // the column's DECLARED display, not `TextCell` for everything — an
        // instant rendered as text is its epoch number, and an array is a dash.
        <span className="block break-words whitespace-pre-wrap">
          {renderDisplay(display, value, true)}
        </span>
      )}
    </div>
  );
  const copyable = copyableText(value);

  return override?.block === true ? (
    <BlockField label={label} copyable={copyable}>
      {body}
    </BlockField>
  ) : (
    <ScalarField label={label} copyable={copyable}>
      {body}
    </ScalarField>
  );
}

/** Revealed on hover or focus, so a column of buttons does not compete with the
 *  values it is offering to copy. */
const REVEAL =
  "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100";

function ScalarField({
  label,
  copyable,
  children,
}: {
  label: string;
  copyable: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="group grid grid-cols-[minmax(0,7rem)_1fr_auto] items-baseline gap-3 px-4 py-2.5">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      {children}
      {copyable === null ? (
        <span className="size-5" />
      ) : (
        <CopyButton value={copyable} label={label} className={cn("self-center", REVEAL)} />
      )}
    </div>
  );
}

/** Full width, label above — and the copy button rides beside the label,
 *  because there is no third column to put it in. */
function BlockField({
  label,
  copyable,
  children,
}: {
  label: string;
  copyable: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="group flex flex-col gap-1.5 px-4 py-2.5">
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        {copyable === null ? null : (
          <CopyButton value={copyable} label={label} className={REVEAL} />
        )}
      </span>
      {children}
    </div>
  );
}
