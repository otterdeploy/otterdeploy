/**
 * The always-visible row of the pending-changes bar: composition, Discard,
 * Apply.
 *
 * The label used to read "Apply 4 changes", which is a number and nothing
 * else — you could apply without knowing whether those four were creates or a
 * delete. One dot per change, tinted by kind, says what is about to happen
 * while the panel is still shut, in the same width. Capped at eight so a large
 * staged batch can't push the pill off a phone.
 *
 * Split from pending-changes-bar.tsx on the file-length cap, and it reads
 * better alone: this is the part the operator sees whether or not the panel is
 * open, so the pill's honesty rules live in one place.
 */

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

import type { GroupedChange } from "./pending-changes-groups";

import { changeKey } from "./pending-changes-rows";

const DOT_TINT: Record<GroupedChange["kind"], string> = {
  create: "bg-success",
  update: "bg-info",
  delete: "bg-destructive",
};

const DOT_CAP = 8;

export function PendingBarHeader({
  groups,
  chosenCount,
  partial,
  expanded,
  onToggle,
  applying,
  busy,
  onDiscardAll,
  onApply,
}: {
  groups: GroupedChange[];
  chosenCount: number;
  partial: boolean;
  expanded: boolean;
  onToggle: () => void;
  applying: boolean;
  busy: boolean;
  onDiscardAll: () => void;
  onApply: () => void;
}) {
  const dots = groups.slice(0, DOT_CAP);
  const overflow = groups.length - dots.length;

  return (
    <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground hover:opacity-80"
        aria-expanded={expanded}
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            "motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
        <span className="truncate whitespace-nowrap">
          {applying
            ? "Applying…"
            : partial
              ? `${chosenCount} of ${groups.length} changes`
              : `${groups.length} change${groups.length === 1 ? "" : "s"}`}
        </span>
        {/* Decorative: the label carries the count and each row states its own
            kind in words, so the dots add nothing for a screen reader. */}
        <span className="flex shrink-0 items-center gap-1" aria-hidden>
          {dots.map((g) => (
            <span key={changeKey(g)} className={cn("size-1.5 rounded-full", DOT_TINT[g.kind])} />
          ))}
          {overflow > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground">+{overflow}</span>
          )}
        </span>
      </button>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto shrink-0"
        onClick={onDiscardAll}
        disabled={busy}
      >
        Discard
      </Button>
      <Button
        size="sm"
        variant="default"
        className="shrink-0"
        onClick={onApply}
        disabled={busy || chosenCount === 0}
        aria-label={applying ? "Applying" : undefined}
      >
        {/* The button must never promise more than the selection: with rows
            unticked it says how many will actually run. */}
        {applying ? <Spinner className="size-3.5" /> : partial ? `Apply ${chosenCount}` : "Apply"}
      </Button>
    </div>
  );
}
