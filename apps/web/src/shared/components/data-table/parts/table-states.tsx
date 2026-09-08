/**
 * Loading, empty, error — designed rather than defaulted.
 *
 * PRODUCT.md's honest-about-system-state principle is mostly cashed out here.
 * A table that shows nothing while it loads, then nothing when it fails, then
 * nothing when there is nothing, has told the reader the same lie three times.
 *
 * Skeletons over spinners (DESIGN.md): a skeleton says how much is coming and
 * holds the layout still, so the header does not jump when rows arrive.
 */

import { Alert01Icon, FilterRemoveIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Kbd, KbdGroup } from "@/shared/components/ui/kbd";
import { Skeleton } from "@/shared/components/ui/skeleton";

/** Placeholder rows at the real row height, so nothing moves when data lands. */
export function TableSkeleton({ rows = 12, height }: { rows?: number; height: number }) {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading rows">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b px-2" style={{ height }}>
          <Skeleton className="h-3 w-20 shrink-0" />
          <Skeleton className="h-3 w-28 shrink-0" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing matched.
 *
 * The two cases are different facts and read differently: a feed with no rows
 * at all is a state of the system, while a feed with rows that this filter
 * excludes is a state of the QUERY — and the second one gets a way out.
 */
export function TableEmpty({
  hasFilters,
  onClearFilters,
  title,
  description,
}: {
  hasFilters: boolean;
  onClearFilters: () => void;
  title?: string;
  description?: string;
}) {
  if (hasFilters) {
    return (
      <Empty className="border-0 py-16">
        <EmptyHeader>
          <HugeiconsIcon
            icon={FilterRemoveIcon}
            strokeWidth={1.5}
            className="size-9 text-muted-foreground/50"
          />
          <EmptyTitle>No rows match these filters</EmptyTitle>
          <EmptyDescription>
            There is data here, but nothing in the current selection.
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      </Empty>
    );
  }

  return (
    <Empty className="border-0 py-16">
      <EmptyHeader>
        <HugeiconsIcon
          icon={Alert01Icon}
          strokeWidth={1.5}
          className="size-9 text-muted-foreground/50"
        />
        <EmptyTitle>{title ?? "Nothing here yet"}</EmptyTitle>
        <EmptyDescription>
          {description ?? "Rows will appear here as they happen."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function TableError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return <ErrorState title="Couldn't load these rows" message={message} onRetry={onRetry} />;
}

/**
 * The end of the feed, or the way to more of it.
 *
 * The count is the server's, not the number of rows loaded — "500 of 12,480"
 * is the honest sentence, and a client-side guess at the total is how a table
 * quietly stops halfway and looks complete.
 */
export function TableFooterRow({
  loaded,
  filtered,
  total,
  hasMore,
  isFetching,
  onLoadMore,
}: {
  loaded: number;
  filtered: number | null;
  total: number | null;
  hasMore: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
}) {
  return (
    // Three tracks, so the counts stay centred on the table whether or not the
    // legend is showing — a footer that re-centres itself at a breakpoint reads
    // as movement the reader caused.
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
      <span />
      <span className="flex items-center justify-center gap-3">
        <span className="font-mono tabular-nums">
          {loaded.toLocaleString()}
          {filtered === null ? null : ` of ${filtered.toLocaleString()}`}
          {total === null || filtered === total ? null : ` (${total.toLocaleString()} total)`}
        </span>
        {hasMore ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={isFetching}
            onClick={onLoadMore}
          >
            {isFetching ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <span>End of results</span>
        )}
      </span>
      <KeyboardLegend />
    </div>
  );
}

/**
 * What the keyboard can do here, said once where it will be read.
 *
 * Shortcuts nobody can discover are shortcuts nobody uses, and a table is the
 * one surface where a keyboard is genuinely faster than a mouse. It sits at the
 * end of the rows rather than in the toolbar because that is where the reader
 * already is when they run out of rows, and it stands down on narrow screens
 * where there is no keyboard to speak of.
 */
function KeyboardLegend() {
  return (
    <span className="hidden items-center justify-end gap-3 text-xs lg:flex">
      <KbdGroup>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        <span className="ml-0.5">move</span>
      </KbdGroup>
      <KbdGroup>
        <Kbd>↵</Kbd>
        <span className="ml-0.5">open</span>
      </KbdGroup>
      <KbdGroup>
        <Kbd>⌘⇧F</Kbd>
        <span className="ml-0.5">query</span>
      </KbdGroup>
    </span>
  );
}
