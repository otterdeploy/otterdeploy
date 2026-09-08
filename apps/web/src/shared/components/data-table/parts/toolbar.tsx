/**
 * The toolbar: what is being shown, and the controls that change it.
 *
 * The count is the sentence the rest of the page is judged against — "412 of
 * 128,004" is the difference between a filter that worked and a table that
 * silently truncated. It is the SERVER's count, never the number of rows
 * currently loaded.
 */

import type { FilterSpec } from "@otterdeploy/shared/table-filters";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatNumber } from "@otterdeploy/shared/format";

import { useActiveFilterCount, useFilterActions } from "@/shared/components/data-table/state/store";
import { useFilterDraft } from "@/shared/components/data-table/state/use-filter-draft";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

/**
 * The table-wide search box.
 *
 * Debounced, and deliberately not a `<form>`: an operator types into it while
 * reading the rows, and making them press Enter to see the effect turns a scan
 * into a transaction.
 */
function TableSearch({ spec, placeholder }: { spec: FilterSpec; placeholder?: string }) {
  const draft = useFilterDraft(spec.key);

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <HugeiconsIcon
        icon={Search01Icon}
        strokeWidth={2}
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={draft.value}
        onChange={(event) => draft.onChange(event.target.value)}
        placeholder={placeholder ?? "Search"}
        aria-label={placeholder ?? "Search rows"}
        className="h-8 pl-8"
      />
    </div>
  );
}

export interface ToolbarProps {
  /** The declared search filter, when this table has one. */
  searchSpec?: FilterSpec;
  searchPlaceholder?: string;
  /** Server counts. `null` while unknown — never a client-side stand-in. */
  loaded: number;
  filterRowCount: number | null;
  totalRowCount: number | null;
  isFetching: boolean;
  onToggleFilters: () => void;
  filtersOpen: boolean;
  /** Slots for surface-specific controls (live, refresh, export, bulk actions). */
  actions?: React.ReactNode;
}

export function DataTableToolbar({
  searchSpec,
  searchPlaceholder,
  loaded,
  filterRowCount,
  totalRowCount,
  isFetching,
  onToggleFilters,
  filtersOpen,
  actions,
}: ToolbarProps) {
  const activeFilters = useActiveFilterCount();
  const { resetAll } = useFilterActions();

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleFilters}
        aria-expanded={filtersOpen}
        className="h-8 shrink-0 gap-1.5"
      >
        Filters
        {activeFilters > 0 ? (
          <span className="rounded-full bg-primary/10 px-1.5 font-mono text-xs text-primary tabular-nums">
            {activeFilters}
          </span>
        ) : null}
      </Button>

      {searchSpec ? <TableSearch spec={searchSpec} placeholder={searchPlaceholder} /> : null}

      {activeFilters > 0 ? (
        <Button variant="ghost" size="sm" onClick={resetAll} className="h-8 shrink-0">
          Reset
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <RowCount
          loaded={loaded}
          filterRowCount={filterRowCount}
          totalRowCount={totalRowCount}
          isFetching={isFetching}
        />
        {actions}
      </div>
    </div>
  );
}

/**
 * "412 of 128,004 rows".
 *
 * Three numbers exist — loaded, matching, and total — and showing the wrong one
 * is the most common way a table lies. Matching is what the filter produced;
 * total is what the filter was applied to; loaded is a scroll position, so it
 * appears in the footer beside the load-more control and not here.
 */
function RowCount({
  loaded,
  filterRowCount,
  totalRowCount,
  isFetching,
}: {
  loaded: number;
  filterRowCount: number | null;
  totalRowCount: number | null;
  isFetching: boolean;
}) {
  const known = filterRowCount ?? null;
  return (
    <p
      aria-live="polite"
      className={cn(
        "hidden text-xs text-muted-foreground transition-opacity sm:block",
        isFetching && "opacity-60",
      )}
    >
      {known === null ? (
        // Honest about not knowing yet, rather than showing the loaded count as
        // though it were the answer.
        <span className="font-mono tabular-nums">{formatNumber(loaded)} loaded</span>
      ) : (
        <>
          <span className="font-mono font-medium tabular-nums">{formatNumber(known)}</span>
          {totalRowCount !== null && totalRowCount !== known ? (
            <>
              {" of "}
              <span className="font-mono tabular-nums">{formatNumber(totalRowCount)}</span>
            </>
          ) : null}
          {" rows"}
        </>
      )}
    </p>
  );
}
