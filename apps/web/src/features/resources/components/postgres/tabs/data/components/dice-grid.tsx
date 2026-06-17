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
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";

import { DataGrid } from "@/shared/components/data-grid/data-grid";
import { useDataGrid } from "@/shared/components/data-grid/hooks/use-data-grid";
import { useElementHeight } from "@/shared/components/data-grid/hooks/use-element-height";
import type { FkTarget } from "@/shared/components/data-grid/types";

import type { ColumnVariant } from "../data/queries";
import { FkRefPopover } from "./fk-ref-popover";

export type { ColumnVariant };

type Row = Record<string, string | null>;

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

export function DiceResultGrid({
  resourceId,
  columns,
  rows,
  columnVariants,
  columnFks,
  onOpenRef,
  editable = false,
  primaryKey,
  onUpdateRow,
  onDeleteRow,
}: {
  resourceId: never;
  columns: string[];
  rows: (string | null)[][];
  columnVariants?: Record<string, ColumnVariant>;
  columnFks?: Record<string, FkTarget>;
  onOpenRef?: (fk: FkTarget, value: string) => void;
  /** Allow inline edit / delete (actor has write capability). */
  editable?: boolean;
  /** Primary-key columns — required to target a row; empty disables editing. */
  primaryKey?: string[];
  onUpdateRow?: (pk: ColumnValue[], set: ColumnValue[]) => Promise<void>;
  onDeleteRow?: (pk: ColumnValue[]) => Promise<void>;
}) {
  const [fk, setFk] = useState<{
    target: FkTarget;
    value: string;
    anchor: HTMLElement;
  } | null>(null);
  const [data, setData] = useState<Row[]>(() =>
    toRows(columns, rows, columnVariants),
  );
  useEffect(() => {
    setData(toRows(columns, rows, columnVariants));
  }, [columns, rows, columnVariants]);

  // A row can only be mutated if we can target it by primary key.
  const canEdit = editable && (primaryKey?.length ?? 0) > 0;

  // Mirror `data` in a ref so the change/delete handlers can read the pre-edit
  // row (for the PK predicate and for reverting a failed write).
  const dataRef = useRef(data);
  dataRef.current = data;

  const pkFor = (row: Row): ColumnValue[] =>
    (primaryKey ?? []).map((c) => ({ column: c, value: row[c] ?? null }));

  // The grid emits the full next array after an inline edit. Diff it against the
  // pre-edit rows to find the changed row + columns, then persist that row.
  const handleDataChange = (next: Row[]) => {
    const prev = dataRef.current;
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
    const snapshot = dataRef.current;
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

  const colDefs = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((name) => {
        const v = columnVariants?.[name];
        // "boolean" renders as text (showing true/false words) — DiceUI's
        // checkbox variant would replace the words with a checkbox.
        const variant = v == null || v === "boolean" ? "short-text" : v;
        return {
          accessorKey: name,
          header: name,
          meta: { cell: { variant } },
        };
      }),
    [columns, columnVariants],
  );

  const grid = useDataGrid<Row>({
    data,
    columns: colDefs,
    getRowId: (_row, index) => String(index),
    onDataChange: handleDataChange,
    onRowsDelete: canEdit ? (rowsToDelete) => handleRowsDelete(rowsToDelete) : undefined,
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
    <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden">
      {/* No stretchColumns: it flex-grows every column to fill width, so
          resizing one redistributes the rest. Fixed widths = resize one, only
          that one changes (grid scrolls horizontally if columns overflow). */}
      <DataGrid {...grid} height={height} />
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
