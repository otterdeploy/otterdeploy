import type { DeploymentId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
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
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * Stored statuses a cancel can act on — mirrors `CANCELLABLE` in
 * packages/api/src/routers/deployment/cancel.ts. `starting` is excluded on
 * purpose: by then the image is built and swarm is rolling it out, and there is
 * no build left to stop.
 */
export function isCancellable(status: string): boolean {
  return status === "pending" || status === "building";
}

export function CancelDeploymentButton({
  deploymentId,
  status,
  className,
  compact = false,
}: {
  deploymentId: DeploymentId;
  status: string;
  className?: string;
  /** Icon-only, for tight rows (the header activity popover). The label moves to
   *  `aria-label` so the control stays announced. */
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  const cancel = useMutation(
    orpc.deployment.cancel.mutationOptions({
      onSuccess: () => {
        toast.success("Build cancelled");
        // The row's status drives the tab favicon and every deployment list on
        // screen, so refresh broadly rather than patching one cache entry.
        void queryClient.invalidateQueries({ queryKey: orpc.deployment.listByProject.key() });
        // And the header pill, or a cancelled build keeps being counted as
        // queued until the next poll — the one place the staleness is obvious,
        // because you are looking straight at it when you click.
        void queryClient.invalidateQueries({ queryKey: orpc.deployment.activity.key() });
      },
      onError: (error) => {
        // The common "failure" is a benign race — it finished while the dialog
        // was open. Say that, rather than showing a raw 409.
        const message =
          (error as { status?: number })?.status === 409
            ? "That build already finished."
            : (error.message ?? "Could not cancel the build.");
        toast.error(message);
      },
      onSettled: () => setConfirming(false),
    }),
  );

  if (!isCancellable(status)) return null;

  return (
    <>
      <Button
        variant="outline"
        size={compact ? "icon" : "sm"}
        className={cn("px-0.5", className)}
        disabled={cancel.isPending}
        aria-label={compact ? "Stop build" : undefined}
        title={compact ? "Stop build" : undefined}
        onClick={() => setConfirming(true)}
      >
        <HugeiconsIcon icon={StopIcon} strokeWidth={2} className="size-5.5 text-destructive" />
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this build?</AlertDialogTitle>
            <AlertDialogDescription>
              The build container is killed immediately and this deployment is recorded as
              cancelled. Work already done is discarded — starting again means a fresh deploy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>Keep building</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancel.isPending}
              onClick={(e) => {
                // Keep the dialog up while the request is in flight so the
                // button can show progress; `onSettled` closes it.
                e.preventDefault();
                cancel.mutate({ deploymentId });
              }}
            >
              {cancel.isPending ? "Stopping…" : "Stop build"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
