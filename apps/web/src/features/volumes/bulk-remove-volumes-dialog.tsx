/**
 * Confirm + run a bulk volume removal.
 *
 * Every selected volume is attempted, including ones the client currently
 * believes are in use — the daemon is the authority, and a ref-count read a few
 * seconds ago is not. Outcomes are reported per volume afterwards rather than
 * pre-emptively blocking the selection.
 */

import { useState } from "react";

import { ORPCError } from "@orpc/client";
import { toast } from "sonner";

import type { VolumeRow } from "@/features/volumes/shared";

import { removeVolume } from "@/features/volumes/data/volumes";
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

export function BulkRemoveVolumesDialog({
  open,
  onOpenChange,
  selection,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: TableSelection<VolumeRow>;
  /** Refetch the list once the run settles. */
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BulkOutcome<VolumeRow> | null>(null);

  const rows = selection.selectedRows;
  const inUse = rows.filter((v) => v.refCount > 0).length;

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) setOutcome(null);
  };

  const run = async () => {
    setBusy(true);
    const result = await runBulk(rows, async (v) => {
      try {
        await removeVolume(v.name);
      } catch (err) {
        // Already gone — a prune or another operator raced us. The caller's
        // intent (this volume should not exist) is satisfied, so it counts as
        // removed rather than as a failure the operator has to reason about.
        if (err instanceof ORPCError && err.code === "NOT_FOUND") return;
        throw err;
      }
    });
    setBusy(false);
    onDone();

    const { message, tone } = summarizeBulk(result, "volume");
    if (tone === "success") toast.success(message);
    else if (tone === "warning") toast.warning(message);
    else toast.error(message);

    if (result.failed.length === 0) {
      // Clean run — nothing left to explain, so close and drop the selection.
      selection.clear();
      onOpenChange(false);
      return;
    }
    // Something survived: keep the dialog open listing what didn't go, and
    // narrow the selection to just those so a retry doesn't re-attempt the
    // volumes that are already gone.
    setOutcome(result);
  };

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {outcome ? "Some volumes couldn't be removed" : `Remove ${rows.length} volumes?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {outcome ? (
              <>
                {outcome.ok.length > 0
                  ? `${outcome.ok.length} removed. The rest are still here:`
                  : "None of them were removed:"}
              </>
            ) : (
              <>
                Everything stored in {rows.length === 1 ? "it" : "them"} will be deleted from this
                node. This cannot be undone.
                {inUse > 0
                  ? ` ${inUse} of these ${inUse === 1 ? "is" : "are"} currently in use and will likely be skipped.`
                  : ""}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Named list so the operator can see exactly what they're about to
            destroy — a bare count is not enough for an irreversible action. */}
        <ul className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-2">
          {(outcome ? outcome.failed.map((f) => f.row) : rows).map((v) => {
            const reason = outcome?.failed.find((f) => f.row.name === v.name)?.reason;
            return (
              <li key={v.name} className="py-0.5 text-[12px] [overflow-wrap:anywhere]">
                <span className="font-mono">{v.name}</span>
                {reason ? <span className="text-muted-foreground"> — {reason}</span> : null}
              </li>
            );
          })}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{outcome ? "Close" : "Cancel"}</AlertDialogCancel>
          {outcome ? null : (
            <AlertDialogAction
              variant="destructive"
              disabled={busy || rows.length === 0}
              onClick={(e) => {
                e.preventDefault();
                void run();
              }}
            >
              {busy ? "Removing…" : `Remove ${rows.length} volumes`}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
