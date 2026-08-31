/**
 * Adapter: render a `database.query` result (dynamic columns + string rows)
 * through the vendored DiceUI data-grid (TanStack Table + virtualization +
 * editable cells). One page of server-fetched rows is fed in as the grid's
 * in-memory `data`; every column is a short-text editable cell.
 *
 * When `editable` is set (the actor has `database:write` and the table has a
 * primary key), an inline edit is STAGED through `onStageEdit` rather than
 * written: it becomes a draft the parent counts, shows in a diff, and commits
 * as one transaction. Row deletes still go straight through `onDeleteRow`,
 * because a delete has nothing to review — the row either goes or it does not.
 * Changes apply optimistically and revert on a server error.
 *
 * Table-browse extras (all opt-in via props):
 * - `selectable` prepends a checkbox column (multi-select for bulk delete /
 *   export-selected; state mirrored up via `onSelectionChange`);
 * - `enableRowDetail` prepends a per-row chevron that opens the RowDetailPanel
 *   on the right (every column, per-field copy, jump-to-inline-edit);
 * - `hiddenColumns` drops columns from the GRID only. The data (and therefore
 *   exports and the detail panel) keeps every column.
 */

import type { CellValue, ColumnMeta } from "@otterdeploy/data-engine";

import { useState } from "react";

import { Result } from "better-result";
import { toast } from "sonner";

import type { FkTarget } from "@/shared/components/data-grid/types";

import { DataGrid } from "@/shared/components/data-grid/data-grid";
import { useDataGrid } from "@/shared/components/data-grid/hooks/use-data-grid";
import { useElementHeight } from "@/shared/components/data-grid/hooks/use-element-height";

import type { WorkbenchTarget } from "../data/target";

import { cellOf, useDiceColumnDefs, type Row } from "./dice-grid-columns";
import {
  diffEditedRow,
  errText,
  primaryKeyFor,
  RowDetailSlot,
  useGridRows,
  useSelectionMirror,
} from "./dice-grid-parts";
import { FkRefPopover } from "./fk-ref-popover";

/**
 * A column predicate / assignment passed to the write endpoint.
 *
 * `value` is a typed cell, so setting a column to SQL NULL is expressible and
 * distinct from setting it to the empty string. The predecessor's
 * `string | null` could not say the difference, which meant the grid could not
 * clear a text column without also being unable to blank it.
 */
export interface ColumnValue {
  column: string;
  value: CellValue;
}

export function DiceResultGrid({
  target,
  columns,
  rows,
  columnFks,
  columnTypes,
  hiddenColumns,
  onOpenRef,
  editable = false,
  primaryKey,
  onStageEdit,
  onDeleteRow,
  selectable = false,
  onSelectionChange,
  enableRowDetail = false,
}: {
  target: WorkbenchTarget;
  columns: readonly ColumnMeta[];
  rows: readonly CellValue[][];
  columnFks?: Record<string, FkTarget>;
  /** Collapsed display types for the row-detail panel's field labels. */
  columnTypes?: Record<string, string>;
  /** Column names excluded from the grid (not from the data / detail panel). */
  hiddenColumns?: string[];
  onOpenRef?: (fk: FkTarget, value: string) => void;
  /** Allow inline edit / delete (actor has write capability). */
  editable?: boolean;
  /** Primary-key columns, required to target a row; empty disables editing. */
  primaryKey?: string[];
  /**
   * Stage an inline edit. Given the row's key and what changed, with each
   * change carrying the value it is replacing so the review drawer can show a
   * real before → after.
   */
  onStageEdit?: (pk: ColumnValue[], changes: Array<ColumnValue & { previous: CellValue }>) => void;
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
  const [data, setData] = useGridRows(columns, rows);

  // A row can only be mutated if we can target it by primary key.
  const canEdit = editable && (primaryKey?.length ?? 0) > 0;

  // The change/delete handlers read the pre-edit rows (for the PK predicate and
  // for reverting a failed write) straight from the closed-over `data`: the grid
  // always invokes the latest handler, so this closure mirrors current state.
  // Key columns are read from the PRE-EDIT row, so a key that was itself
  // edited still targets the row as it exists on the server.
  const pkFor = (row: Row): ColumnValue[] => primaryKeyFor(columns, primaryKey ?? [], row);

  // The grid emits the full next array after an inline edit. Diff it against the
  // pre-edit rows to find the changed row + columns, then persist that row.
  /**
   * An inline edit becomes a DRAFT, not an UPDATE.
   *
   * The predecessor fired a statement the moment focus left a cell, so editing
   * four columns of a row was four statements and a violation on the fourth
   * left the row half-changed. Here the edit is staged: the grid shows it, the
   * bar counts it, and the whole set commits as one transaction.
   *
   * An edit that does not parse into the column's kind is still rejected on the
   * spot, because staging a value the database will certainly refuse only moves
   * the error further from the keystroke that caused it.
   */
  const handleDataChange = (next: Row[]) => {
    const prev = data;
    setData(next);
    if (!canEdit || !onStageEdit) return;
    for (let i = 0; i < next.length; i++) {
      const before = prev[i];
      const after = next[i];
      if (!before || !after || before === after) continue;
      const diff = diffEditedRow(columns, before, after);
      if (diff.invalid !== null) {
        setData((cur) => cur.map((r) => (r === after ? before : r)));
        toast.error(diff.invalid);
        continue;
      }
      if (diff.set.length === 0) continue;
      onStageEdit(
        pkFor(before),
        diff.set.map((change) => ({
          ...change,
          // The pre-edit value, for the diff. Read from `before` so it is what
          // the SERVER last returned, not whatever the cell showed a keystroke ago.
          previous: cellOf(before[change.column]),
        })),
      );
    }
  };

  const handleRowsDelete = async (rowsToDelete: Row[]) => {
    if (!canEdit || !onDeleteRow) return;
    const snapshot = data;
    const toDelete = new Set(rowsToDelete);
    setData((cur) => cur.filter((r) => !toDelete.has(r)));
    for (const row of rowsToDelete) {
      const deleted = await Result.tryPromise({
        try: () => onDeleteRow(pkFor(row)),
        catch: (cause) => errText(cause, "Couldn't delete the row."),
      });
      if (deleted.isErr()) {
        setData(snapshot);
        toast.error(deleted.error);
        return;
      }
    }
  };

  const colDefs = useDiceColumnDefs({
    columns,
    hiddenColumns,
    selectable,
    enableRowDetail,
    // Stable setState identity: keeps the memoized defs from re-building.
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div ref={wrapRef} className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* No stretchColumns: it flex-grows every column to fill width, so
            resizing one redistributes the rest. Fixed widths = resize one, only
            that one changes (grid scrolls horizontally if columns overflow). */}
        <DataGrid {...grid} height={height} />
      </div>

      <RowDetailSlot
        index={detailIndex}
        data={data}
        columns={columns.map((c) => c.name)}
        columnTypes={columnTypes}
        primaryKey={primaryKey}
        editable={canEdit}
        onEditField={(column) => {
          // Jump to the inline editor for this cell (hidden columns aren't in
          // the grid: unhide first to edit them there).
          if (detailIndex === null || !canEdit || (hiddenColumns ?? []).includes(column)) return;
          grid.tableMeta.scrollToCell?.(detailIndex, column);
          grid.tableMeta.onCellEditingStart?.(detailIndex, column);
        }}
        onClose={() => setDetailIndex(null)}
      />

      {fk ? (
        <FkRefPopover
          target={target}
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
