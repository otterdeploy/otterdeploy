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

import { defineFilters, type FilterSpec, type Filters } from "@otterdeploy/shared/table-filters";

import type { DataTableFeatures } from "@/shared/components/data-table/features";
import type { DataTableColumn, Display } from "@/shared/components/data-table/schema/types";

import {
  BadgeCell,
  ClockCell,
  BarCell,
  BooleanCell,
  CodeCell,
  InstantCell,
  NumberCell,
  StateCell,
  TextCell,
} from "@/shared/components/data-table/cells";
import { columnValue } from "@/shared/components/data-table/schema/read-value";
import { defaultDisplay, toFilterSpecs } from "@/shared/components/data-table/schema/types";
import { Checkbox } from "@/shared/components/ui/checkbox";

/**
 * A value, rendered the way its column declared.
 *
 * Shared with the row sheet, which used to render every cell-less column
 * through `TextCell` regardless of what it said it was. That printed an
 * instant as its raw epoch number and an array as the empty dash — on the
 * audit log too, where `at` and `target` both went through it.
 */
export function renderDisplay(display: Display, value: unknown, wrap = false): ReactNode {
  switch (display.type) {
    case "text":
      return <TextCell value={value} wrap={wrap} />;
    case "code":
      return <CodeCell value={value} tone={display.tone?.(value)} wrap={wrap} />;
    case "clock":
      return <ClockCell value={value} />;
    case "number":
      return <NumberCell value={value} unit={display.unit} />;
    case "instant":
      return <InstantCell value={value} />;
    case "badge":
      return <BadgeCell value={value} tone={display.tone?.(value)} wrap={wrap} />;
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
function selectColumn<TRow extends RowData>(): ColumnDef<DataTableFeatures, TRow> {
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
/**
 * A trailing column of per-row actions.
 *
 * A render prop rather than a declared column, because the useful actions are
 * MUTATIONS: unblocking an IP, cancelling a deploy, rolling one back. Those
 * need a hook, a confirmation and an invalidation, none of which a module-level
 * column declaration can close over — the same reason the toolbar's `actions`
 * is a render prop.
 *
 * Never sortable, never hideable, never in the row sheet: it is furniture, not
 * a field. It stops the row-open click from firing so that pressing Unblock
 * does not also open the sheet behind the confirmation.
 */
function actionsColumn<TRow extends RowData>(
  render: (row: TRow) => React.ReactNode,
): ColumnDef<DataTableFeatures, TRow> {
  return {
    id: "actions",
    size: 92,
    minSize: 92,
    maxSize: 92,
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    // Pinned to the trailing edge. A wide table scrolls horizontally, and row
    // actions that scroll away with it are actions you have to go looking for —
    // on the access log at 1440px the Block button sat entirely off-screen.
    meta: { label: "Actions", kind: "text", cellClassName: "justify-end", pinned: true },
    header: () => null,
    cell: ({ row }) => (
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- a click shield, not a control: the buttons inside carry their own semantics
      <span className="flex w-full justify-end" onClick={(event) => event.stopPropagation()}>
        {render(row.original)}
      </span>
    ),
  };
}

/** One declared column, as a TanStack definition. */
function dataColumn<TRow extends RowData>(
  column: DataTableColumn<TRow>,
  filterFn: ReturnType<Filters["filterFn"]>,
): ColumnDef<DataTableFeatures, TRow> {
  const display = column.display ?? defaultDisplay(column.kind);
  // A number reads against its neighbours, so the column trails right.
  const isTrailing = display.type === "number";

  return {
    id: column.key,
    // A dotted key ("timing.dns") is one column id, not a path into the row,
    // so the value is read explicitly rather than through accessorKey.
    accessorFn: (row) => columnValue(column, row),
    header: column.label,
    cell: ({ getValue, row }) =>
      column.cell
        ? column.cell({ value: getValue(), row: row.original })
        : renderDisplay(display, getValue()),
    enableSorting: column.sortable ?? false,
    enableHiding: column.alwaysVisible !== true,
    // Only a column with a declared width can be dragged: a flexing column's
    // rendered width is not the width TanStack would resize FROM, so the first
    // drag would jump by the difference.
    enableResizing: (column.resizable ?? false) && column.width !== undefined,
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
  };
}

export function buildColumns<TRow extends RowData>(
  columns: readonly DataTableColumn<TRow>[],
  options?: {
    specs?: readonly FilterSpec[];
    selectable?: boolean;
    rowActions?: (row: TRow) => React.ReactNode;
  },
): ColumnDef<DataTableFeatures, TRow>[] {
  // The specs the SERVER holds are passed in when they differ from what the UI
  // would derive (a server-owned option set, say); otherwise they are derived
  // from the same declaration, which is the point.
  const filters = defineFilters(options?.specs ?? toFilterSpecs(columns));

  const defs: ColumnDef<DataTableFeatures, TRow>[] = options?.selectable
    ? [selectColumn<TRow>()]
    : [];

  for (const column of columns) {
    // A filter-only declaration (the search box) is not a column.
    if (column.filterOnly) continue;
    defs.push(dataColumn(column, filters.filterFn(column.key)));
  }

  if (options?.rowActions) defs.push(actionsColumn<TRow>(options.rowActions));

  return defs;
}

function metaKind(display: Display) {
  switch (display.type) {
    case "code":
      return "code" as const;
    case "number":
    case "bar":
      return "number" as const;
    // A clock IS an instant to everything downstream — the trailing/alignment
    // rules and the header's zone mark both key off this, and omitting it is
    // how a UTC clock column shipped without saying it was UTC.
    case "clock":
    case "instant":
      return "instant" as const;
    case "badge":
    case "state":
      return "badge" as const;
    default:
      return "text" as const;
  }
}
