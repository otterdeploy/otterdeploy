/**
 * Adapter: render a `database.query` result (dynamic columns + string rows)
 * through the vendored DiceUI data-grid (TanStack Table + virtualization +
 * editable cells). One page of server-fetched rows is fed in as the grid's
 * in-memory `data`; every column is a short-text editable cell. Edits update
 * local state only for now — persistence (UPDATE via a write endpoint) is the
 * next backend slice.
 */

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataGrid } from "@/shared/components/data-grid/data-grid";
import { useDataGrid } from "@/shared/components/data-grid/hooks/use-data-grid";
import { useElementHeight } from "@/shared/components/data-grid/hooks/use-element-height";
import type { FkTarget } from "@/shared/components/data-grid/types";

import type { ColumnVariant } from "../data/queries";
import { FkRefPopover } from "./fk-ref-popover";

export type { ColumnVariant };

type Row = Record<string, string | null>;

/** psql --csv emits booleans as t/f; show the words instead. */
function boolWord(v: string): string {
  if (v === "t" || v === "true" || v === "TRUE") return "true";
  if (v === "f" || v === "false" || v === "FALSE") return "false";
  return v;
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
  readOnly = true,
}: {
  resourceId: never;
  columns: string[];
  rows: (string | null)[][];
  columnVariants?: Record<string, ColumnVariant>;
  columnFks?: Record<string, FkTarget>;
  onOpenRef?: (fk: FkTarget, value: string) => void;
  readOnly?: boolean;
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
    onDataChange: setData,
    readOnly,
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
