/**
 * Where the filters live: a sheet, at every width.
 *
 * They were a column beside the rows, and that was the wrong trade on a table
 * this dense. The sidebar took a fifth of the width permanently to show
 * controls that are touched for a few seconds at a time, and the rows — which
 * are what the page is FOR, and which carry ids and timestamps that do not
 * shorten — spent the rest of the session squeezed into what was left.
 *
 * So the rows get the whole width and the filters come over them on demand,
 * from the same Filters button at every size. The chips under the toolbar are
 * what makes this honest: with the panel closed, the filter state is still
 * written down on the page rather than hidden behind a count.
 */

import type { RowData } from "@tanstack/react-table";

import { useCallback, useState } from "react";

import type { Facets } from "@/shared/components/data-table/feed/types";
import type { DataTableColumn } from "@/shared/components/data-table/schema/types";

import { DataTableFilterPanel } from "@/shared/components/data-table/parts/filter-panel";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";

export interface FilterPanelState {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

/** Closed until asked for. */
export function useFilterPanel(): FilterPanelState {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  return { open, toggle, setOpen };
}

export function FilterRegion<TRow extends RowData>({
  columns,
  facets,
  open,
  onOpenChange,
}: {
  columns: readonly DataTableColumn<TRow>[];
  facets: Facets;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xs">
        <SheetHeader className="border-b px-3 py-3">
          <SheetTitle className="text-left text-sm">Filters</SheetTitle>
          <SheetDescription className="sr-only">Narrow the rows in this table.</SheetDescription>
        </SheetHeader>
        <DataTableFilterPanel columns={columns} facets={facets} />
      </SheetContent>
    </Sheet>
  );
}
