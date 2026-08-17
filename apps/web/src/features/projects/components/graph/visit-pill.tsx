/**
 * "Visit": the one-click way from a graph node to the thing it is serving.
 *
 * Extracted from the PR-preview card, which had it first and had it right:
 * opening the deployed thing is what people come to the graph to do, and it
 * deserves its own affordance rather than living one level down in a panel.
 * Previews were the ONLY node that offered it; a service or a stack member with
 * a public domain showed nothing at all.
 *
 * `nodrag`/`nopan` keep React Flow from reading the click as a canvas gesture,
 * and stopPropagation on both click and mousedown keeps it from also selecting
 * the node, which would slide the detail panel over the tab just opened.
 * PublicHostLink is the non-canvas equivalent; it cannot be reused here
 * because those two React Flow concerns are specific to this surface.
 */

import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

export function VisitPill({
  url,
  className,
  compact,
}: {
  /** Bare host or full URL. `https://` is added when absent. */
  url: string;
  className?: string;
  /** Icon only: for dense rows (a stack's member list) where the word does
   *  not fit without pushing the status pill off the card. */
  compact?: boolean;
}) {
  const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      title={`Open ${href}`}
      className={cn(
        "nodrag nopan inline-flex shrink-0 items-center gap-1 rounded-md border text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
        compact ? "px-1.5 py-0.5" : "px-2 py-1",
        className,
      )}
    >
      {compact ? null : "Visit"}
      <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-3" />
    </a>
  );
}
