/**
 * Declaration → TanStack column definitions.
 *
 * One pass over the schema produces the columns, their cells, their sizing and
 * their filter functions. The filter function comes from the SAME
 * `defineFilters` the server compiles its WHERE clause from, handed over as a
 * function rather than a registered name — a name is a contract that breaks
 * silently the one time someone forgets to register it.
 */

import type { ColumnDef, RowData } from "@tanstack/react-table";

import type { ReactNode } from "react";

import { defineFilters, type FilterSpec } from "@otterdeploy/shared/table-filters";

import type { DataTableFeatures } from "@/shared/components/data-table/features";
import type { DataTableColumn, Display } from "@/shared/components/data-table/schema/types";

import {
  BadgeCell,
  BarCell,
  BooleanCell,
  CodeCell,
  InstantCell,
  NumberCell,
  StateCell,
  TextCell,
} from "@/shared/components/data-table/cells";
import { defaultDisplay, toFilterSpecs } from "@/shared/components/data-table/schema/types";
import { Checkbox } from "@/shared/components/ui/checkbox";

function renderDisplay(display: Display, value: unknown): ReactNode {
  switch (display.type) {
    case "text":
      return <TextCell value={value} />;
    case "code":
      return <CodeCell value={value} />;
    case "number":
      return <NumberCell value={value} unit={display.unit} />;
    case "instant":
      return <InstantCell value={value} />;
    case "badge":
      return <BadgeCell value={value} tone={display.tone?.(value)} />;
    case "state":
      return <StateCell value={value} tone={display.tone(value)} />;
    case "boolean":
      return <BooleanCell value={value} />;
    case "bar":
      return <BarCell value={value} min={display.min} max={display.max} unit={display.unit} />;
  }
}

/**
 * The one reading of `width` / `minWidth` / `resizable`:
 *
 * - `minWidth` alone — the column flexes to absorb leftover width but never
 *   compresses below its floor.
 * - `width` alone — locked: min and max pin it, so only unsized columns flex.
 * - `width` + `resizable` — `width` is the starting width and nothing more.
 */
function sizing(column: { width?: number; minWidth?: number; resizable?: boolean }) {
  if (column.minWidth !== undefined) {
    return { minSize: column.minWidth, ...(column.width ? { size: column.width } : {}) };
  }
  if (column.width === undefined) return {};
  if (column.resizable) return { size: column.width };
  return { size: column.width, minSize: column.width, maxSize: column.width };
}

/** The selection gutter. Not filterable, not sortable, never hidden. */
export function selectColumn<TRow extends RowData>(): ColumnDef<DataTableFeatures, TRow> {
  return {
    id: "select",
    size: 36,
    minSize: 36,
    maxSize: 36,
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    meta: { label: "Select", kind: "select" },
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows on this page"
        checked={table.getIsAllRowsSelected()}
        indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label="Select row"
        checked={row.getIsSelected()}
        // The checkbox acts on the row itself; a click here must not also open
        // the detail sheet, including clicks on the padding around the control.
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
      />
    ),
  };
}

/** Turn a schema into column definitions. */
export function buildColumns<TRow extends RowData>(
  columns: readonly DataTableColumn<TRow>[],
  options?: { specs?: readonly FilterSpec[]; selectable?: boolean },
): ColumnDef<DataTableFeatures, TRow>[] {
  // The specs the SERVER holds are passed in when they differ from what the UI
  // would derive (a server-owned option set, say); otherwise they are derived
  // from the same declaration, which is the point.
  const filters = defineFilters(options?.specs ?? toFilterSpecs(columns));

  const defs: ColumnDef<DataTableFeatures, TRow>[] = options?.selectable
    ? [selectColumn<TRow>()]
    : [];

  for (const column of columns) {
    const display = column.display ?? defaultDisplay(column.kind);
    const filterFn = filters.filterFn(column.key);
    const isTrailing = display.type === "number";

    defs.push({
      id: column.key,
      // A dotted key ("timing.dns") is one column id, not a path into the row,
      // so the value is read explicitly rather than through accessorKey.
      accessorFn: (row) => column.accessor?.(row) ?? readKey(row, column.key),
      header: column.label,
      cell: ({ getValue, row }) =>
        column.cell
          ? column.cell({ value: getValue(), row: row.original })
          : renderDisplay(display, getValue()),
      enableSorting: column.sortable ?? false,
      enableHiding: column.alwaysVisible !== true,
      enableResizing: column.resizable ?? false,
      ...(filterFn ? { filterFn } : {}),
      ...sizing(column),
      meta: {
        label: column.label,
        kind: metaKind(display),
        ...(column.headerClassName ? { headerClassName: column.headerClassName } : {}),
        cellClassName: [column.cellClassName, isTrailing ? "text-right" : undefined]
          .filter(Boolean)
          .join(" "),
        ...(column.hidden ? { defaultHidden: true } : {}),
      },
    });
  }

  return defs;
}

function metaKind(display: Display) {
  switch (display.type) {
    case "code":
      return "code" as const;
    case "number":
    case "bar":
      return "number" as const;
    case "instant":
      return "instant" as const;
    case "badge":
    case "state":
      return "badge" as const;
    default:
      return "text" as const;
  }
}

/** Read a key off a row without a type assertion. */
function readKey(row: unknown, key: string): unknown {
  if (typeof row !== "object" || row === null) return undefined;
  return Object.hasOwn(row, key) ? Reflect.get(row, key) : undefined;
}
