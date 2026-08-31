/**
 * The non-rendering machinery behind {@link DiceResultGrid}: the in-memory row
 * buffer, the selection mirror, and the row-detail slot.
 *
 * The value COERCION that used to live here is gone. It existed because
 * `psql --csv` handed the UI strings: booleans arrived as `t`/`f` and had to be
 * turned back into words, and nothing else could be trusted either. Rows are now
 * typed `CellValue`s, so a boolean is a boolean and there is nothing to coerce.
 */

import type { CellValue, ColumnMeta } from "@otterdeploy/data-engine";
import type { RowSelectionState, Updater } from "@tanstack/react-table";

import { useRef, useState } from "react";

import { parseCell } from "@otterdeploy/data-engine";

import type { ColumnValue } from "./dice-grid";

import { cellText, isNullCell, type Row } from "./dice-grid-columns";
import { RowDetailPanel } from "./row-detail-panel";

/** Pull a human-readable reason out of an oRPC error (QUERY_FAILED carries
 *  `data.reason`), falling back to a default. */
export function errText(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    if ("data" in error) {
      const data = error.data;
      if (data && typeof data === "object" && "reason" in data && typeof data.reason === "string") {
        return data.reason;
      }
    }
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

/**
 * The columns an inline edit changed, PARSED back into their declared kinds.
 *
 * An edit that does not parse is refused rather than coerced: silently turning
 * "12x" into 12 is how a grid edit corrupts a row. `invalid` carries the
 * message so the caller can revert the row and say why.
 */
export function diffEditedRow(
  columns: readonly ColumnMeta[],
  before: Row,
  after: Row,
): { set: ColumnValue[]; invalid: string | null } {
  const set: ColumnValue[] = [];
  for (const c of columns) {
    if (before[c.name] === after[c.name]) continue;
    const edited = after[c.name];
    if (typeof edited !== "string") {
      set.push({ column: c.name, value: edited ?? null });
      continue;
    }
    const parsed = parseCell(edited, c.kind);
    if (parsed === undefined) {
      return { set: [], invalid: `"${edited}" is not a valid ${c.dataType || c.kind}` };
    }
    set.push({ column: c.name, value: parsed });
  }
  return { set, invalid: null };
}

/**
 * The primary-key predicate for a row.
 *
 * Read from the PRE-EDIT row, so a key column that was itself edited still
 * targets the row as it exists on the server rather than as the user has just
 * retyped it.
 */
export function primaryKeyFor(
  columns: readonly ColumnMeta[],
  primaryKey: readonly string[],
  row: Row,
): ColumnValue[] {
  return primaryKey.map((name) => {
    const meta = columns.find((col) => col.name === name);
    const raw = row[name];
    if (typeof raw !== "string") return { column: name, value: raw ?? null };
    // Transient editor text in a key: parse it back, or send it as text and
    // let the server's own type check reject it.
    return { column: name, value: (meta && parseCell(raw, meta.kind)) ?? { k: "text", v: raw } };
  });
}

/** Positional server rows → column-keyed rows, with no value coercion. */
function toRows(columns: readonly ColumnMeta[], rows: readonly CellValue[][]): Row[] {
  return rows.map((r) => {
    const obj: Row = {};
    columns.forEach((c, i) => {
      // `?? null` is for a short row, not for a null value: a SQL NULL is
      // already `null` and stays distinguishable from a missing column.
      obj[c.name] = r[i] ?? null;
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
export function useGridRows(columns: readonly ColumnMeta[], rows: readonly CellValue[][]) {
  const [data, setData] = useState<Row[]>(() => toRows(columns, rows));
  const [source, setSource] = useState({ columns, rows });
  if (source.columns !== columns || source.rows !== rows) {
    setSource({ columns, rows });
    setData(toRows(columns, rows));
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
  // The detail panel is a read/edit form over display text; typed cells are
  // rendered to their string form at this boundary rather than teaching the
  // panel the whole CellValue union.
  const displayRow: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(row)) {
    displayRow[key] = isNullCell(value) ? null : cellText(value);
  }
  return (
    <RowDetailPanel
      columns={columns}
      row={displayRow}
      columnTypes={columnTypes}
      primaryKey={primaryKey}
      editable={editable}
      onEditField={onEditField}
      onClose={onClose}
    />
  );
}
