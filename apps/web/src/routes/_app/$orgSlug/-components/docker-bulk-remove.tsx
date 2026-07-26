/**
 * Confirm + run a bulk removal for a Docker inventory table (images, networks).
 *
 * Generic over the row type: each table supplies how to label a row and how to
 * remove one. The run is a client-side fan-out over the existing single-item
 * endpoint — see the note in `shared/components/table-selection` for why that
 * beats a bulk API here.
 */

import { useState } from "react";

import { toast } from "sonner";

import {
  runBulk,
  summarizeBulk,
  type BulkOutcome,
  type TableSelection,
} from "@/shared/components/table-selection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";

export function DockerBulkRemoveDialog<T>({
  open,
  onOpenChange,
  selection,
  noun,
  labelOf,
  removeOne,
  consequence,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: TableSelection<T>;
  /** Singular noun — "image", "network". */
  noun: string;
  labelOf: (row: T) => string;
  removeOne: (row: T) => Promise<unknown>;
  /** Consequence copy — say what breaks, not just "are you sure". */
  consequence: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BulkOutcome<T> | null>(null);

  const rows = selection.selectedRows;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) setOutcome(null);
  };

  const run = async () => {
    setBusy(true);
    const result = await runBulk(rows, removeOne);
    setBusy(false);
    onDone();

    const { message, tone } = summarizeBulk(result, noun);
    if (tone === "success") toast.success(message);
    else if (tone === "warning") toast.warning(message);
    else toast.error(message);

    if (result.failed.length === 0) {
      selection.clear();
      onOpenChange(false);
      return;
    }
    // Keep the dialog open showing what survived and why, so the daemon's
    // reason isn't lost to a toast the operator may not have been looking at.
    setOutcome(result);
  };

  const listed = outcome ? outcome.failed.map((f) => f.row) : rows;

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {outcome
              ? `Some ${noun}s couldn't be removed`
              : `Remove ${plural(rows.length)}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {outcome
              ? outcome.ok.length > 0
                ? `${plural(outcome.ok.length)} removed. The rest are still here:`
                : "None of them were removed:"
              : consequence}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Named list — a bare count is not enough for an irreversible action. */}
        <ul className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-2">
          {listed.map((row) => {
            const label = labelOf(row);
            const reason = outcome?.failed.find((f) => labelOf(f.row) === label)?.reason;
            return (
              <li key={label} className="py-0.5 text-[12px] [overflow-wrap:anywhere]">
                <span className="font-mono">{label}</span>
                {reason ? <span className="text-muted-foreground"> — {reason}</span> : null}
              </li>
            );
          })}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{outcome ? "Close" : "Cancel"}</AlertDialogCancel>
          {outcome ? null : (
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              disabled={busy || rows.length === 0}
              onClick={(e) => {
                e.preventDefault();
                void run();
              }}
            >
              {busy ? "Removing…" : `Remove ${plural(rows.length)}`}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
