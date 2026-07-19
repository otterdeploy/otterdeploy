/**
 * Column definitions for {@link DiceResultGrid} — the optional select-checkbox
 * and row-detail-chevron columns plus one editable short-text column per
 * result column. Split out so the grid component stays within the
 * per-function line budget.
 */

import type { ColumnDef } from "@tanstack/react-table";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Checkbox } from "@/shared/components/ui/checkbox";

import type { ColumnVariant } from "../data/queries";

export type Row = Record<string, string | null>;

export function useDiceColumnDefs({
  columns,
  columnVariants,
  hiddenColumns,
  selectable,
  enableRowDetail,
  onOpenDetail,
}: {
  columns: string[];
  columnVariants?: Record<string, ColumnVariant>;
  hiddenColumns?: string[];
  selectable: boolean;
  enableRowDetail: boolean;
  onOpenDetail: (rowIndex: number) => void;
}): ColumnDef<Row>[] {
  const defs: ColumnDef<Row>[] = [];
  // Function header/cell → the grid flexRenders them; keyboard navigation
    // skips the "select" / "actions" column ids by design.
    if (selectable) {
      defs.push({
        id: "select",
        size: 44,
        enableSorting: false,
        enableResizing: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all rows"
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
            onCheckedChange={(v) => table.toggleAllRowsSelected(Boolean(v))}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
          />
        ),
      });
    }
    if (enableRowDetail) {
      defs.push({
        id: "actions",
        size: 36,
        enableSorting: false,
        enableResizing: false,
        header: () => null,
        cell: ({ row }) => (
          <button
            type="button"
            aria-label="Open row detail"
            onClick={() => onOpenDetail(row.index)}
            className="flex size-full items-center justify-center text-muted-foreground/50 hover:text-foreground"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
          </button>
        ),
      });
    }
    const hidden = new Set(hiddenColumns ?? []);
    for (const name of columns) {
      if (hidden.has(name)) continue;
      const v = columnVariants?.[name];
      // "boolean" renders as text (showing true/false words) — DiceUI's
      // checkbox variant would replace the words with a checkbox.
      const variant = v == null || v === "boolean" ? "short-text" : v;
      defs.push({
        accessorKey: name,
        header: name,
        meta: { cell: { variant } },
      });
    }
  return defs;
}
