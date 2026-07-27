/**
 * The non-rendering machinery behind {@link DiceResultGrid}: value coercion for
 * a `database.query` result, the in-memory row buffer, the selection mirror, and
 * the row-detail slot.
 *
 * Split out of dice-grid.tsx because every one of these carried branching (or
 * lines) the grid component itself was being charged for — the adapter file is
 * now just the wiring between the query result and the vendored DiceUI grid,
 * while the pieces that decide *what* a value/row/selection is live here.
 */

import type { RowSelectionState, Updater } from "@tanstack/react-table";

import { useRef, useState } from "react";

import type { ColumnVariant } from "../data/queries";

import { type Row } from "./dice-grid-columns";
import { RowDetailPanel } from "./row-detail-panel";

/** psql --csv emits booleans as t/f; show the words instead. */
function boolWord(v: string): string {
  if (v === "t" || v === "true" || v === "TRUE") return "true";
  if (v === "f" || v === "false" || v === "FALSE") return "false";
  return v;
}

/** Pull a human-readable reason out of an oRPC error (QUERY_FAILED carries
 *  `data.reason`), falling back to a default. */
export function errText(error: unknown, fallback: string): string {
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

/**
 * The grid's in-memory rows, re-synced whenever a fresh page of server rows
 * arrives.
 *
 * The re-sync happens during render (not in an effect) so new columns never
 * paint against the previous page's rows for a frame.
 */
export function useGridRows(
  columns: string[],
  rows: (string | null)[][],
  columnVariants: Record<string, ColumnVariant> | undefined,
) {
  const [data, setData] = useState<Row[]>(() => toRows(columns, rows, columnVariants));
  const [source, setSource] = useState({ columns, rows, columnVariants });
  if (
    source.columns !== columns ||
    source.rows !== rows ||
    source.columnVariants !== columnVariants
  ) {
    setSource({ columns, rows, columnVariants });
    setData(toRows(columns, rows, columnVariants));
  }
  return [data, setData] as const;
}

/** Mirror the grid store's row selection out as row indices (row id = index). */
export function useSelectionMirror(onSelectionChange?: (indices: number[]) => void) {
  const selectionRef = useRef<RowSelectionState>({});
  return (updater: Updater<RowSelectionState>) => {
    const next = typeof updater === "function" ? updater(selectionRef.current) : updater;
    selectionRef.current = next;
    onSelectionChange?.(
      Object.keys(next)
        .filter((k) => next[k])
        .reduce<number[]>((acc, k) => {
          const n = Number(k);
          if (Number.isInteger(n)) acc.push(n);
          return acc;
        }, [])
        .sort((a, b) => a - b),
    );
  };
}

/**
 * The right-hand row-detail panel, mounted from the grid's `detailIndex`. The
 * "is a row open?" resolution sits next to the panel it controls; the caller
 * just hands over the index and the slot renders nothing when none is open.
 */
export function RowDetailSlot({
  index,
  data,
  columns,
  columnTypes,
  primaryKey,
  editable,
  onEditField,
  onClose,
}: {
  index: number | null;
  data: Row[];
  columns: string[];
  columnTypes?: Record<string, string>;
  primaryKey?: string[];
  editable: boolean;
  onEditField: (column: string) => void;
  onClose: () => void;
}) {
  const row = index === null ? undefined : data[index];
  if (row === undefined) return null;
  return (
    <RowDetailPanel
      columns={columns}
      row={row}
      columnTypes={columnTypes}
      primaryKey={primaryKey}
      editable={editable}
      onEditField={onEditField}
      onClose={onClose}
    />
  );
}
