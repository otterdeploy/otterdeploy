import type { CellValue } from "@otterdeploy/data-engine";

/**
 * The staged-edits bar and its review drawer.
 *
 * The bar is the promise: nothing has been written yet, here is how much is
 * pending, and here are the three things you can do about it. The drawer is the
 * proof — a real before → after per column, grouped by row, with a per-row
 * discard.
 *
 * "Commit" sends every draft as ONE transaction. The bar says so, because the
 * guarantee is the reason to trust the button.
 */
import { useState } from "react";

import { ArrowRight01Icon, Cancel01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { displayText } from "@otterdeploy/data-engine";

import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { cn } from "@/shared/lib/utils";

import type { Draft, PrimaryKeys } from "../data/drafts";

import { groupByRow } from "../data/drafts";

export function DraftsBar({
  drafts,
  isCommitting,
  onCommit,
  onDiscardAll,
  onDiscardRow,
}: {
  drafts: readonly Draft[];
  isCommitting: boolean;
  onCommit: () => void;
  onDiscardAll: () => void;
  onDiscardRow: (keys: PrimaryKeys) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  if (drafts.length === 0) return null;

  const rows = groupByRow(drafts);
  const cells = drafts.length;

  return (
    <>
      <div className="flex items-center gap-2 border-t bg-primary/5 px-3 py-1.5 text-[12.5px]">
        <b>
          {cells} unsaved change{cells === 1 ? "" : "s"}
        </b>
        <span className="text-muted-foreground">
          across {rows.length} row{rows.length === 1 ? "" : "s"} — nothing is written until you
          commit.
        </span>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-6"
          disabled={isCommitting}
          onClick={onDiscardAll}
        >
          Discard
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6"
          disabled={isCommitting}
          onClick={() => setReviewing(true)}
        >
          Review diff
        </Button>
        <Button size="sm" className="h-6 gap-1.5" disabled={isCommitting} onClick={onCommit}>
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5" />
          {isCommitting ? "Committing…" : "Commit"}
        </Button>
      </div>

      <Sheet open={reviewing} onOpenChange={setReviewing}>
        <SheetContent side="right" className="flex w-[min(34rem,92vw)] flex-col gap-0 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-[14px]">Review changes</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              {cells} change{cells === 1 ? "" : "s"} across {rows.length} row
              {rows.length === 1 ? "" : "s"}. Committing runs them as a single transaction: all of
              them land, or none do.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((row) => (
              <div key={row.key} className="border-b">
                <div className="flex items-center gap-2 bg-muted/30 px-4 py-1.5">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {describeKeys(row.primaryKeys)}
                  </span>
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Discard this row's changes"
                    onClick={() => onDiscardRow(row.primaryKeys)}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
                  </Button>
                </div>
                {row.changes.map((change) => (
                  <div
                    key={change.column}
                    className="flex items-start gap-2 px-4 py-2 font-mono text-[11.5px]"
                  >
                    <span className="w-28 shrink-0 truncate text-muted-foreground">
                      {change.column}
                    </span>
                    <Value cell={change.previous} muted />
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                    />
                    <Value cell={change.value} />
                  </div>
                ))}
              </div>
            ))}
          </div>

          <SheetFooter className="flex-row gap-2 border-t px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => setReviewing(false)}>
              Keep editing
            </Button>
            <span className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={isCommitting}
              onClick={() => {
                onDiscardAll();
                setReviewing(false);
              }}
            >
              Discard all
            </Button>
            <Button
              size="sm"
              disabled={isCommitting}
              onClick={() => {
                onCommit();
                setReviewing(false);
              }}
            >
              {isCommitting ? "Committing…" : "Commit"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * One side of a diff.
 *
 * NULL and the empty string are rendered as distinct sentinels rather than as
 * nothing, because the whole point of the diff is to show which one you are
 * about to write.
 */
function Value({ cell, muted = false }: { cell: CellValue; muted?: boolean }) {
  if (cell === null) {
    return (
      <span className={cn("flex-1 italic", muted ? "opacity-40" : "text-muted-foreground")}>
        NULL
      </span>
    );
  }
  const text = displayText(cell);
  if (text === "") {
    return (
      <span className={cn("flex-1 italic", muted ? "opacity-40" : "text-muted-foreground")}>
        empty
      </span>
    );
  }
  return (
    <span className={cn("min-w-0 flex-1 wrap-break-word", muted && "text-muted-foreground/60")}>
      {text}
    </span>
  );
}

/** `id = 8843` — which row this group is about. */
function describeKeys(keys: PrimaryKeys): string {
  return Object.entries(keys)
    .map(([column, cell]) => `${column} = ${cell === null ? "NULL" : displayText(cell)}`)
    .join(", ");
}
