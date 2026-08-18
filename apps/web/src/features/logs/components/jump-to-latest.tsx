/**
 * The floating "Jump to latest" pill every follow-the-tail scroller shows once
 * the reader scrolls up into history. One shared affordance so pausing and
 * resuming the tail looks the same on the Logs page, the deployment log tabs,
 * and the per-service tail. The nearest positioned ancestor decides where it
 * floats: render it inside a `relative` wrapper around the scroller.
 */

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[11px] font-medium shadow-md hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5" />
      Jump to latest
    </button>
  );
}
