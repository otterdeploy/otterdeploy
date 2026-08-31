"use client";

import type { ColumnDef, TableMeta } from "@tanstack/react-table";

import * as React from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  CellOpts,
  CellUpdate,
  ContextMenuState,
  CopyRowsFormat,
} from "@/shared/components/data-grid/types";

import { useAsRef } from "@/shared/components/data-grid/hooks/use-as-ref";
import { parseCellKey } from "@/shared/components/data-grid/lib/data-grid";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

import { CopyIcon, EraserIcon, ScissorsIcon, Trash2Icon } from "./icons";

const COPY_ROW_FORMATS: readonly CopyRowsFormat[] = ["json", "csv", "tsv", "markdown", "sql"];

interface DataGridContextMenuProps<TData> {
  tableMeta: TableMeta<TData>;
  columns: Array<ColumnDef<TData>>;
  contextMenu: ContextMenuState;
}

export function DataGridContextMenu<TData>({
  tableMeta,
  columns,
  contextMenu,
}: DataGridContextMenuProps<TData>) {
  const onContextMenuOpenChange = tableMeta?.onContextMenuOpenChange;
  const selectionState = tableMeta?.selectionState;
  const dataGridRef = tableMeta?.dataGridRef;
  const onDataUpdate = tableMeta?.onDataUpdate;
  const onRowsDelete = tableMeta?.onRowsDelete;
  const onCellsCopy = tableMeta?.onCellsCopy;
  const onCellsCut = tableMeta?.onCellsCut;
  const onRowsCopyAs = tableMeta?.onRowsCopyAs;

  if (!contextMenu.open) return null;

  return (
    <ContextMenu
      tableMeta={tableMeta}
      columns={columns}
      dataGridRef={dataGridRef}
      contextMenu={contextMenu}
      onContextMenuOpenChange={onContextMenuOpenChange}
      selectionState={selectionState}
      onDataUpdate={onDataUpdate}
      onRowsDelete={onRowsDelete}
      onCellsCopy={onCellsCopy}
      onCellsCut={onCellsCut}
      onRowsCopyAs={onRowsCopyAs}
    />
  );
}

/**
 * The slice of a ColumnDef the menu actually reads (id / accessorKey lookup +
 * the cell variant). Structural and TData-free, so the memoized component
 * below needs no generic parameter: every ColumnDef<TData> satisfies it.
 */
interface ContextMenuColumn {
  id?: string;
  meta?: { label?: string; cell?: CellOpts };
}

// The custom TableMeta fields this menu uses are all row-type independent, so
// the props can be stated over TableMeta<unknown> and accept any grid's meta.
interface ContextMenuProps
  extends
    Pick<
      TableMeta<unknown>,
      | "dataGridRef"
      | "onContextMenuOpenChange"
      | "selectionState"
      | "onDataUpdate"
      | "onRowsDelete"
      | "onCellsCopy"
      | "onRowsCopyAs"
      | "onCellsCut"
      | "readOnly"
    >,
    Required<Pick<TableMeta<unknown>, "contextMenu">> {
  tableMeta: TableMeta<unknown>;
  columns: ReadonlyArray<ContextMenuColumn>;
}

const ContextMenu = React.memo(ContextMenuImpl, (prev, next) => {
  if (prev.contextMenu.open !== next.contextMenu.open) return false;
  if (!next.contextMenu.open) return true;
  if (prev.contextMenu.x !== next.contextMenu.x) return false;
  if (prev.contextMenu.y !== next.contextMenu.y) return false;

  const prevSize = prev.selectionState?.selectedCells?.size ?? 0;
  const nextSize = next.selectionState?.selectedCells?.size ?? 0;
  if (prevSize !== nextSize) return false;

  return true;
});

function ContextMenuImpl({
  tableMeta,
  columns,
  dataGridRef,
  contextMenu,
  onContextMenuOpenChange,
  selectionState,
  onDataUpdate,
  onRowsDelete,
  onCellsCopy,
  onCellsCut,
  onRowsCopyAs,
}: ContextMenuProps) {
  const { t } = useTranslation();
  const propsRef = useAsRef({
    dataGridRef,
    selectionState,
    onDataUpdate,
    onRowsDelete,
    onCellsCopy,
    onCellsCut,
    onRowsCopyAs,
    columns,
  });

  const triggerStyle: React.CSSProperties = {
    position: "fixed",
    left: `${contextMenu.x}px`,
    top: `${contextMenu.y}px`,
    width: "1px",
    height: "1px",
    padding: 0,
    margin: 0,
    border: "none",
    background: "transparent",
    pointerEvents: "none",
    opacity: 0,
  };

  // Base UI's Menu manages close-focus itself; no onCloseAutoFocus hook.
  const onCopy = () => {
    propsRef.current.onCellsCopy?.();
  };

  const onCut = () => {
    propsRef.current.onCellsCut?.();
  };

  // Same row resolution the delete uses: every row that owns a selected cell.
  const onCopyRowsAs = (format: CopyRowsFormat) => {
    const { selectionState, onRowsCopyAs: copyAs } = propsRef.current;
    if (!copyAs || !selectionState?.selectedCells?.size) return;
    const rowIndices = new Set<number>();
    for (const cellKey of selectionState.selectedCells) {
      rowIndices.add(parseCellKey(cellKey).rowIndex);
    }
    copyAs(
      Array.from(rowIndices).sort((a, b) => a - b),
      format,
    );
  };

  const onClear = () => {
    const { selectionState, columns, onDataUpdate } = propsRef.current;

    if (!selectionState?.selectedCells || selectionState.selectedCells.size === 0) return;

    const updates: Array<CellUpdate> = [];

    for (const cellKey of selectionState.selectedCells) {
      const { rowIndex, columnId } = parseCellKey(cellKey);

      // Get column from columns array
      const column = columns.find((col) => {
        if (col.id) return col.id === columnId;
        if ("accessorKey" in col) return col.accessorKey === columnId;
        return false;
      });
      const cellVariant = column?.meta?.cell?.variant;

      let emptyValue: unknown = "";
      if (cellVariant === "multi-select" || cellVariant === "file") {
        emptyValue = [];
      } else if (cellVariant === "number" || cellVariant === "date") {
        emptyValue = null;
      } else if (cellVariant === "checkbox") {
        emptyValue = false;
      }

      updates.push({ rowIndex, columnId, value: emptyValue });
    }

    onDataUpdate?.(updates);

    toast.success(t("dataGrid.cellsCleared", { count: updates.length }));
  };

  const onDelete = async () => {
    const { selectionState, onRowsDelete } = propsRef.current;

    if (!selectionState?.selectedCells || selectionState.selectedCells.size === 0) return;

    const rowIndices = new Set<number>();
    for (const cellKey of selectionState.selectedCells) {
      const { rowIndex } = parseCellKey(cellKey);
      rowIndices.add(rowIndex);
    }

    const rowIndicesArray = Array.from(rowIndices).sort((a, b) => a - b);
    const rowCount = rowIndicesArray.length;

    await onRowsDelete?.(rowIndicesArray);

    toast.success(t("dataGrid.rowsDeleted", { count: rowCount }));
  };

  return (
    <DropdownMenu open={contextMenu.open} onOpenChange={onContextMenuOpenChange}>
      <DropdownMenuTrigger style={triggerStyle} />
      <DropdownMenuContent data-grid-popover="" align="start" className="w-48">
        <DropdownMenuItem onClick={onCopy}>
          <CopyIcon />
          Copy
        </DropdownMenuItem>
        {onRowsCopyAs ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CopyIcon />
              Copy row as
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36">
              {COPY_ROW_FORMATS.map((format) => (
                <DropdownMenuItem key={format} onClick={() => onCopyRowsAs(format)}>
                  {format === "markdown" ? "Markdown" : format.toUpperCase()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuItem onClick={onCut} disabled={tableMeta?.readOnly}>
          <ScissorsIcon />
          Cut
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onClear} disabled={tableMeta?.readOnly}>
          <EraserIcon />
          Clear
        </DropdownMenuItem>
        {onRowsDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete rows
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
