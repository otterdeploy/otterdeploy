/**
 * Offset pagination for the non-relational viewers.
 *
 * Lived inside the MariaDB tab, which MongoDB then imported across three
 * directory levels — so deleting that tab when MariaDB moved onto the shared
 * workbench would have taken Mongo's pager with it. It was always shared; now
 * it says so.
 *
 * Deliberately offset-based and deliberately dumb: it reports the RANGE it is
 * showing rather than a total, because neither Redis nor MongoDB gives a cheap
 * exact count and a paginator that displays "1–20 of ?" is more honest than one
 * that runs a full scan to fill in the number.
 */
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";

export function Pager({
  offset,
  page,
  hasMore,
  loading,
  onPrev,
  onNext,
}: {
  offset: number;
  /** Rows on the current page, not the page size: the last page is short. */
  page: number;
  hasMore: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {offset + 1}–{offset + page}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={offset === 0 || loading}
        onClick={onPrev}
        aria-label="Previous page"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={!hasMore || loading}
        onClick={onNext}
        aria-label="Next page"
      >
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
      </Button>
    </div>
  );
}
