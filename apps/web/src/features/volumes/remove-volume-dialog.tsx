/**
 * Remove-volume confirmation with an in-use guard: a mounted or
 * platform-claimed volume can't be confirmed away from here — the dialog
 * explains who holds it instead of offering a doomed button. The server
 * re-checks the same rule (`IN_USE`), so the guard can't be bypassed.
 */
import { useState } from "react";

import { ORPCError } from "@orpc/client";
import { toast } from "sonner";

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

import type { VolumeRow } from "./shared";

import { removeVolume } from "./data/volumes";

function blockReason(volume: VolumeRow): string | null {
  if (volume.refCount > 0) {
    const names = volume.containerNames.slice(0, 3).join(", ");
    const extra =
      volume.containerNames.length > 3 ? ` and ${volume.containerNames.length - 3} more` : "";
    return `It is mounted by ${names}${extra}. Stop or remove those containers first.`;
  }
  if (volume.attachedTo.length > 0) {
    const owner = volume.attachedTo[0];
    return `It belongs to the ${owner.resourceType} "${owner.resourceName}" in ${owner.projectSlug}. Delete the resource instead — removing its volume here would destroy its data.`;
  }
  return null;
}

export function RemoveVolumeDialog({
  volume,
  onOpenChange,
}: {
  /** Volume to remove; null keeps the dialog closed. */
  volume: VolumeRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const reason = volume ? blockReason(volume) : null;

  const confirm = async () => {
    if (!volume || busy) return;
    setBusy(true);
    try {
      await removeVolume(volume.name);
      toast.success(`Volume ${volume.name} removed`);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ORPCError && err.code === "IN_USE") {
        const data = err.data as { reason?: string } | undefined;
        toast.error(data?.reason ?? "Volume is in use");
      } else if (err instanceof ORPCError && err.code === "NOT_FOUND") {
        // Already gone (raced a prune / another operator) — refresh handled
        // by the data layer's invalidation.
        toast.info("Volume was already removed");
        onOpenChange(false);
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't remove the volume");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={volume !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove <span className="font-mono">{volume?.name}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {reason ??
              "The volume and everything stored in it will be deleted from this node. This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{reason ? "Close" : "Cancel"}</AlertDialogCancel>
          {reason ? null : (
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
              disabled={busy}
            >
              {busy ? "Removing…" : "Remove volume"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
