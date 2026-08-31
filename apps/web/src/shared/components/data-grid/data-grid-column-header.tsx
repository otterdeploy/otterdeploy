"use client";

import type { ColumnSort, Header, SortDirection, SortingState, Table } from "@tanstack/react-table";

import * as React from "react";

import { useTranslation } from "react-i18next";

import { getColumnVariant } from "@/shared/components/data-grid/lib/data-grid";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

import { ChevronDownIcon, ChevronUpIcon, EyeOffIcon, PinIcon, PinOffIcon, XIcon } from "./icons";

interface DataGridColumnHeaderProps<TData, TValue> extends React.ComponentProps<
  typeof DropdownMenuTrigger
> {
  header: Header<TData, TValue>;
  table: Table<TData>;
}

export function DataGridColumnHeader<TData, TValue>({
  header,
  table,
  className,
  onPointerDown,
  ...props
}: DataGridColumnHeaderProps<TData, TValue>) {
  const column = header.column;
  const label = column.columnDef.meta?.label
    ? column.columnDef.meta.label
    : typeof column.columnDef.header === "string"
      ? column.columnDef.header
      : column.id;

  const isAnyColumnResizing = table.getState().columnSizingInfo.isResizingColumn;

  const cellVariant = column.columnDef.meta?.cell;
  const columnVariant = getColumnVariant(cellVariant?.variant);

  const pinnedPosition = column.getIsPinned();
  const isPinnedLeft = pinnedPosition === "left";
  const isPinnedRight = pinnedPosition === "right";

  const onSortingChange = (direction: SortDirection) => {
    table.setSorting((prev: SortingState) => {
      const existingSortIndex = prev.findIndex((sort) => sort.id === column.id);
      const newSort: ColumnSort = {
        id: column.id,
        desc: direction === "desc",
      };

      if (existingSortIndex >= 0) {
        const updated = [...prev];
        updated[existingSortIndex] = newSort;
        return updated;
      } else {
        return [...prev, newSort];
      }
    });
  };

  const onSortRemove = () => {
    table.setSorting((prev: SortingState) => prev.filter((sort) => sort.id !== column.id));
  };

  const onLeftPin = () => {
    column.pin("left");
  };

  const onRightPin = () => {
    column.pin("right");
  };

  const onUnpin = () => {
    column.pin(false);
  };

  // Typed off the trigger's own prop so the forwarded event carries Base UI's
  // extensions (preventBaseUIHandler & co), not just the React pointer event.
  const onTriggerPointerDown: React.ComponentProps<typeof DropdownMenuTrigger>["onPointerDown"] = (
    event,
  ) => {
    onPointerDown?.(event);
    if (event.defaultPrevented) return;

    if (event.button !== 0) {
      return;
    }
    table.options.meta?.onColumnClick?.(column.id);
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={cn(
            "flex size-full items-center justify-between gap-2 p-2 font-mono text-[12px] hover:bg-accent/40 data-[state=open]:bg-accent/40 [&_svg]:size-4",
            isAnyColumnResizing && "pointer-events-none",
            className,
          )}
          onPointerDown={onTriggerPointerDown}
          {...props}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {/* A rich labelNode brings its own glyphs (key, FK arrow, type
                tag); stacking the variant icon in front of it says "text"
                twice in one header. */}
            {columnVariant && !column.columnDef.meta?.labelNode && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <columnVariant.icon className="size-3.5 shrink-0 text-muted-foreground" />
                  }
                />
                <TooltipContent side="top">
                  <p>{columnVariant.label}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {column.columnDef.meta?.labelNode ?? <span className="truncate">{label}</span>}
          </div>
          <ChevronDownIcon className="shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={0} className="w-60">
          {column.getCanSort() && (
            <>
              <DropdownMenuCheckboxItem
                className="relative ltr:pr-8 ltr:pl-2 rtl:pr-2 rtl:pl-8 [&_svg]:text-muted-foreground [&>span:first-child]:ltr:right-2 [&>span:first-child]:ltr:left-auto [&>span:first-child]:rtl:right-auto [&>span:first-child]:rtl:left-2"
                checked={column.getIsSorted() === "asc"}
                onClick={() => onSortingChange("asc")}
              >
                <ChevronUpIcon />
                Sort asc
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                className="relative ltr:pr-8 ltr:pl-2 rtl:pr-2 rtl:pl-8 [&_svg]:text-muted-foreground [&>span:first-child]:ltr:right-2 [&>span:first-child]:ltr:left-auto [&>span:first-child]:rtl:right-auto [&>span:first-child]:rtl:left-2"
                checked={column.getIsSorted() === "desc"}
                onClick={() => onSortingChange("desc")}
              >
                <ChevronDownIcon />
                Sort desc
              </DropdownMenuCheckboxItem>
              {column.getIsSorted() && (
                <DropdownMenuItem onClick={onSortRemove}>
                  <XIcon />
                  Remove sort
                </DropdownMenuItem>
              )}
            </>
          )}
          {column.getCanPin() && (
            <>
              {column.getCanSort() && <DropdownMenuSeparator />}

              {isPinnedLeft ? (
                <DropdownMenuItem className="[&_svg]:text-muted-foreground" onClick={onUnpin}>
                  <PinOffIcon />
                  Unpin from left
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className="[&_svg]:text-muted-foreground" onClick={onLeftPin}>
                  <PinIcon />
                  Pin to left
                </DropdownMenuItem>
              )}
              {isPinnedRight ? (
                <DropdownMenuItem className="[&_svg]:text-muted-foreground" onClick={onUnpin}>
                  <PinOffIcon />
                  Unpin from right
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className="[&_svg]:text-muted-foreground" onClick={onRightPin}>
                  <PinIcon />
                  Pin to right
                </DropdownMenuItem>
              )}
            </>
          )}
          {column.getCanHide() && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="[&_svg]:text-muted-foreground"
                onClick={() => column.toggleVisibility(false)}
              >
                <EyeOffIcon />
                Hide column
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {header.column.getCanResize() && (
        <DataGridColumnResizer header={header} table={table} label={label} />
      )}
    </>
  );
}

const DataGridColumnResizer = React.memo(DataGridColumnResizerImpl, (prev, next) => {
  const prevColumn = prev.header.column;
  const nextColumn = next.header.column;

  if (
    prevColumn.getIsResizing() !== nextColumn.getIsResizing() ||
    prevColumn.getSize() !== nextColumn.getSize()
  ) {
    return false;
  }

  if (prev.label !== next.label) return false;

  return true;
});

/**
 * The narrow structural slice of `Header`/`Table` the resizer actually reads.
 * Deliberately free of the `TData`/`TValue` generics: `Header` is invariant in
 * them, which is what forced the old `React.memo(...) as typeof Impl` cast.
 * Any `Header<TData, TValue>` / `Table<TData>` satisfies this shape.
 */
interface DataGridColumnResizerProps {
  header: {
    column: {
      getIsResizing: () => boolean;
      getSize: () => number;
      resetSize: () => void;
    };
    getResizeHandler: () => (event: unknown) => void;
  };
  table: {
    _getDefaultColumnDef: () => { minSize?: number; maxSize?: number };
  };
  label: string;
}

function DataGridColumnResizerImpl({ header, table, label }: DataGridColumnResizerProps) {
  const { t } = useTranslation();
  const defaultColumnDef = table._getDefaultColumnDef();

  const onDoubleClick = () => {
    header.column.resetSize();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("dataGrid.resizeColumn", { label })}
      aria-valuenow={header.column.getSize()}
      aria-valuemin={defaultColumnDef.minSize}
      aria-valuemax={defaultColumnDef.maxSize}
      tabIndex={0}
      className={cn(
        "absolute -end-px top-0 z-50 h-full w-0.5 cursor-ew-resize touch-none bg-border transition-opacity select-none after:absolute after:inset-y-0 after:start-1/2 after:h-full after:w-[18px] after:-translate-x-1/2 after:content-[''] hover:bg-primary focus:bg-primary focus:outline-none",
        header.column.getIsResizing() ? "bg-primary" : "opacity-0 hover:opacity-100",
      )}
      onDoubleClick={onDoubleClick}
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
    />
  );
}
