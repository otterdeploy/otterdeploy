/**
 * Adapter: render a `database.query` result (dynamic columns + string rows)
 * through the vendored DiceUI data-grid (TanStack Table + virtualization +
 * editable cells). One page of server-fetched rows is fed in as the grid's
 * in-memory `data`; every column is a short-text editable cell.
 *
 * When `editable` is set (the actor has `database:write` and the table has a
 * primary key), inline edits and row deletes persist through the parent's
 * `onUpdateRow` / `onDeleteRow` callbacks (which call `database.mutateRow`).
 * Changes apply optimistically and revert on a server error.
 *
 * Table-browse extras (all opt-in via props):
 * - `selectable` prepends a checkbox column (multi-select for bulk delete /
 *   export-selected; state mirrored up via `onSelectionChange`);
 * - `enableRowDetail` prepends a per-row chevron that opens the RowDetailPanel
 *   on the right (every column, per-field copy, jump-to-inline-edit);
 * - `hiddenColumns` drops columns from the GRID only — the data (and therefore
 *   exports and the detail panel) keeps every column.
 */

import type { RowSelectionState, Updater } from "@tanstack/react-table";

import { useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import type { FkTarget } from "@/shared/components/data-grid/types";

import { DataGrid } from "@/shared/components/data-grid/data-grid";
import { useDataGrid } from "@/shared/components/data-grid/hooks/use-data-grid";
import { useElementHeight } from "@/shared/components/data-grid/hooks/use-element-height";

import type { ColumnVariant } from "../data/queries";

import { useDiceColumnDefs, type Row } from "./dice-grid-columns";
import { FkRefPopover } from "./fk-ref-popover";
import { RowDetailPanel } from "./row-detail-panel";

export type { ColumnVariant };

/** A column predicate / assignment passed to the write endpoint. */
export interface ColumnValue {
  column: string;
  value: string | null;
}

/** psql --csv emits booleans as t/f; show the words instead. */
function boolWord(v: string): string {
  if (v === "t" || v === "true" || v === "TRUE") return "true";
  if (v === "f" || v === "false" || v === "FALSE") return "false";
  return v;
}

/** Pull a human-readable reason out of an oRPC error (QUERY_FAILED carries
 *  `data.reason`), falling back to a default. */
function errText(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const data = (error as { data?: { reason?: unknown } }).data;
    if (data && typeof data.reason === "string") return data.reason;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function toRows(
  columns: string[],
  rows: (string | null)[][],
  variants?: Record<string, ColumnVariant>,
): Row[] {
  return rows.map((r) => {
    const obj: Row = {};
    columns.forEach((c, i) => {
      let v = r[i] ?? null;
      if (v !== null && variants?.[c] === "boolean") v = boolWord(v);
      obj[c] = v;
    });
    return obj;
  });
}

/** Mirror the grid store's row selection out as row indices (row id = index). */
function useSelectionMirror(onSelectionChange?: (indices: number[]) => void) {
  const selectionRef = useRef<RowSelectionState>({});
  return (updater: Updater<RowSelectionState>) => {
    const next = typeof updater === "function" ? updater(selectionRef.current) : updater;
    selectionRef.current = next;
    onSelectionChange?.(
      Object.keys(next)
        .filter((k) => next[k])
        .map(Number)
        .filter((n) => Number.isInteger(n))
        .sort((a, b) => a - b),
    );
  };
}

export function DiceResultGrid({
  resourceId,
  columns,
  rows,
  columnVariants,
  columnFks,
  columnTypes,
  hiddenColumns,
  onOpenRef,
  editable = false,
  primaryKey,
  onUpdateRow,
  onDeleteRow,
  selectable = false,
  onSelectionChange,
  enableRowDetail = false,
}: {
  resourceId: never;
  columns: string[];
  rows: (string | null)[][];
  columnVariants?: Record<string, ColumnVariant>;
  columnFks?: Record<string, FkTarget>;
  /** Collapsed display types for the row-detail panel's field labels. */
  columnTypes?: Record<string, string>;
  /** Column names excluded from the grid (not from the data / detail panel). */
  hiddenColumns?: string[];
  onOpenRef?: (fk: FkTarget, value: string) => void;
  /** Allow inline edit / delete (actor has write capability). */
  editable?: boolean;
  /** Primary-key columns — required to target a row; empty disables editing. */
  primaryKey?: string[];
  onUpdateRow?: (pk: ColumnValue[], set: ColumnValue[]) => Promise<void>;
  onDeleteRow?: (pk: ColumnValue[]) => Promise<void>;
  /** Show the multi-select checkbox column (bulk delete / export selected). */
  selectable?: boolean;
  /** Selected row indices (into `rows`), newest state on every change. */
  onSelectionChange?: (indices: number[]) => void;
  /** Show the per-row detail chevron + right-hand detail panel. */
  enableRowDetail?: boolean;
}) {
  const [fk, setFk] = useState<{
    target: FkTarget;
    value: string;
    anchor: HTMLElement;
  } | null>(null);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [data, setData] = useState<Row[]>(() => toRows(columns, rows, columnVariants));
  useEffect(() => {
    setData(toRows(columns, rows, columnVariants));
  }, [columns, rows, columnVariants]);

  // A row can only be mutated if we can target it by primary key.
  const canEdit = editable && (primaryKey?.length ?? 0) > 0;

  // The change/delete handlers read the pre-edit rows (for the PK predicate and
  // for reverting a failed write) straight from the closed-over `data`: the grid
  // always invokes the latest handler, so this closure mirrors current state.
  const pkFor = (row: Row): ColumnValue[] =>
    (primaryKey ?? []).map((c) => ({ column: c, value: row[c] ?? null }));

  // The grid emits the full next array after an inline edit. Diff it against the
  // pre-edit rows to find the changed row + columns, then persist that row.
  const handleDataChange = (next: Row[]) => {
    const prev = data;
    setData(next);
    if (!canEdit || !onUpdateRow) return;
    for (let i = 0; i < next.length; i++) {
      const before = prev[i];
      const after = next[i];
      if (!before || !after || before === after) continue;
      const set = columns
        .filter((c) => before[c] !== after[c])
        .map((c) => ({ column: c, value: after[c] ?? null }));
      if (set.length === 0) continue;
      onUpdateRow(pkFor(before), set).catch((err) => {
        // Revert just this row to its pre-edit value.
        setData((cur) => cur.map((r) => (r === after ? before : r)));
        toast.error(errText(err, "Couldn't save the change."));
      });
    }
  };

  const handleRowsDelete = async (rowsToDelete: Row[]) => {
    if (!canEdit || !onDeleteRow) return;
    const snapshot = data;
    setData((cur) => cur.filter((r) => !rowsToDelete.includes(r)));
    for (const row of rowsToDelete) {
      try {
        await onDeleteRow(pkFor(row));
      } catch (err) {
        setData(snapshot);
        toast.error(errText(err, "Couldn't delete the row."));
        return;
      }
    }
  };

  const colDefs = useDiceColumnDefs({
    columns,
    columnVariants,
    hiddenColumns,
    selectable,
    enableRowDetail,
    // Stable setState identity — keeps the memoized defs from re-building.
    onOpenDetail: setDetailIndex,
  });

  const handleRowSelectionChange = useSelectionMirror(onSelectionChange);

  const grid = useDataGrid<Row>({
    data,
    columns: colDefs,
    getRowId: (_row, index) => String(index),
    onDataChange: handleDataChange,
    onRowsDelete: canEdit ? (rowsToDelete) => handleRowsDelete(rowsToDelete) : undefined,
    onRowSelectionChange: selectable ? handleRowSelectionChange : undefined,
    readOnly: !canEdit,
    enableSearch: true,
    overscan: 12,
    meta: {
      fks: columnFks,
      onFkOpen: (target, value, anchor) => setFk({ target, value, anchor }),
    },
  });

  const [wrapRef, height] = useElementHeight<HTMLDivElement>();

  const detailRow = detailIndex !== null ? data[detailIndex] : undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div ref={wrapRef} className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* No stretchColumns: it flex-grows every column to fill width, so
            resizing one redistributes the rest. Fixed widths = resize one, only
            that one changes (grid scrolls horizontally if columns overflow). */}
        <DataGrid {...grid} height={height} />
      </div>

      {detailRow !== undefined && detailIndex !== null ? (
        <RowDetailPanel
          columns={columns}
          row={detailRow}
          columnTypes={columnTypes}
          primaryKey={primaryKey}
          editable={canEdit}
          onEditField={(column) => {
            // Jump to the inline editor for this cell (hidden columns aren't in
            // the grid — unhide first to edit them there).
            if (!canEdit || (hiddenColumns ?? []).includes(column)) return;
            grid.tableMeta.scrollToCell?.(detailIndex, column);
            grid.tableMeta.onCellEditingStart?.(detailIndex, column);
          }}
          onClose={() => setDetailIndex(null)}
        />
      ) : null}

      {fk ? (
        <FkRefPopover
          resourceId={resourceId}
          fk={fk.target}
          value={fk.value}
          anchor={fk.anchor}
          onOpenChange={(open) => {
            if (!open) setFk(null);
          }}
          onOpenRef={(target, value) => onOpenRef?.(target, value)}
        />
      ) : null}
    </div>
  );
}
