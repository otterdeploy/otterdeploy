/**
 * Where the filters live, at whichever width the reader is at.
 *
 * Above the mobile breakpoint they are a column beside the rows, which is the
 * shape that lets someone filter and read the effect in one glance. Below it
 * there is no room for a column, so the same panel opens as a sheet — what this
 * replaces was a Filters button wired to an element with `hidden` on it, so on
 * a phone the button did nothing at all.
 *
 * Each width remembers its own answer. A shared flag would mean that resizing
 * a window past the breakpoint pops a sheet open over the rows, or collapses a
 * sidebar the reader deliberately opened; neither is something they asked for.
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
import { useIsMobile } from "@/shared/hooks/use-mobile";

export interface FilterPanelState {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

/** Open by default where there is room for it, closed where there is not. */
export function useFilterPanel(): FilterPanelState {
  const isMobile = useIsMobile();
  const [wide, setWide] = useState(true);
  const [narrow, setNarrow] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => (isMobile ? setNarrow(next) : setWide(next)),
    [isMobile],
  );
  const toggle = useCallback(
    () => (isMobile ? setNarrow((open) => !open) : setWide((open) => !open)),
    [isMobile],
  );

  return { open: isMobile ? narrow : wide, toggle, setOpen };
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
  const isMobile = useIsMobile();

  if (isMobile) {
    // Mounted only below the breakpoint: a sheet rendered at every width would
    // put a second copy of every control in the tree, and the portal it renders
    // through ignores the `hidden` class that was supposed to keep it away.
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-4/5 max-w-xs gap-0 overflow-y-auto p-0">
          <SheetHeader className="border-b px-3 py-3">
            <SheetTitle className="text-left text-sm">Filters</SheetTitle>
            <SheetDescription className="sr-only">Narrow the rows in this table.</SheetDescription>
          </SheetHeader>
          <DataTableFilterPanel columns={columns} facets={facets} />
        </SheetContent>
      </Sheet>
    );
  }

  if (!open) return null;

  return (
    <aside aria-label="Filters" className="w-56 shrink-0 overflow-y-auto border-r lg:w-64">
      <DataTableFilterPanel columns={columns} facets={facets} />
    </aside>
  );
}
