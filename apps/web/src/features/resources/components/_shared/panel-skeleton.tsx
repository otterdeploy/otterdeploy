import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";

/**
 * Placeholder for the resource drawer while its contents are still resolving.
 * The route's code-split chunk, the `service.get` runtime view, a cold resource
 * collection, or a just-staged ghost whose manifest hasn't landed. Mirrors the
 * real panel's layout (header tile + crumb + title + meta, tab row, body
 * cards) so the drawer slides in with shape rather than blank.
 *
 * The separate status-bar block is gone, matching the loaded header: state
 * folded onto the meta line, so the skeleton no longer promises a row that
 * never arrives.
 *
 * `onClose` renders the header's close button, so a panel that is slow to load
 * is still escapable at the same spot as the loaded one.
 */
export function ResourcePanelSkeleton({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="flex flex-1 flex-col gap-2">
          {/* crumb, name, meta line: the three rows the real header has. */}
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-36" />
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Skeleton className="h-7 w-24 rounded-md" />
        <Skeleton className="h-7 w-24 rounded-md" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </div>
  );
}
