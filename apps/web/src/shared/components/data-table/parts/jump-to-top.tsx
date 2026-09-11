/**
 * The way back to the newest rows.
 *
 * A feed is newest-first and pages downward forever, so a reader who has
 * scrolled into history has no way home but a long drag — and with the tail
 * running, the rows they actually want are arriving at a top they cannot see.
 * Every follow-the-tail scroller in this app already had this control
 * (`features/logs/components/jump-to-latest.tsx`); the shared table shipped
 * without one.
 *
 * It says which of the two things it is doing. While the tail is live, going
 * to the top means going to rows that arrived while the reader was away, so it
 * says "Jump to latest"; with the tail off, the top is just the top.
 */

import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

export function JumpToTop({
  visible,
  isLive,
  onClick,
  className,
}: {
  visible: boolean;
  /** The tail is running, so the top holds rows the reader has not seen. */
  isLive: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Kept mounted and faded, so it does not pop into the layout mid-scroll.
      // `pointer-events-none` while hidden, or it would swallow clicks on the
      // rows underneath it.
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full",
        "border bg-card px-3 py-1.5 text-[11px] font-medium shadow-md",
        "transition-opacity duration-150 motion-reduce:transition-none",
        "hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} className="size-3.5" />
      {isLive ? "Jump to latest" : "Back to top"}
    </button>
  );
}
