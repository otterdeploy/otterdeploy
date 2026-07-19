import { useState } from "react";

/**
 * The one update modal — confirm → live progress → done, all in a dialog (not
 * inline). Opened from the banner, the header button, or the Platform card via
 * the UpdateProvider. Reads the shared status so it always reflects the latest
 * check.
 */
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Markdown } from "@/shared/components/ui/markdown";
import { orpc, queryClient } from "@/shared/server/orpc";

import { useUpdateStatus } from "../data/use-update-status";
import { UpdateProgress } from "./update-progress";

function reasonText(reason: "already-running" | "no-update" | "downgrade"): string {
  switch (reason) {
    case "already-running":
      return "An update is already in progress.";
    case "no-update":
      return "You're already on the latest version.";
    case "downgrade":
      return "The available version isn't newer than what's running.";
  }
}

export function UpdateDialog({
  open,
  onOpenChange,
  attached,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A run already in flight (from the persisted state) to re-attach to when
   *  this browser didn't start it. A fresh local apply takes precedence. */
  attached?: { target: string; dryRun: boolean } | null;
}) {
  const status = useUpdateStatus();
  const [applying, setApplying] = useState<{ target: string; dryRun: boolean } | null>(null);

  // Reset the applying view on close (in the handler, not an effect).
  const handleOpenChange = (next: boolean) => {
    if (!next) setApplying(null);
    onOpenChange(next);
  };

  const apply = useMutation({
    ...orpc.system.apply.mutationOptions(),
    onSuccess: (res) => {
      // Refresh the persisted run-state either way: on start so the progress
      // pane doesn't read a PRIOR run's terminal status (it only polls while
      // running), and on already-running so we re-attach to the live run
      // instead of leaving the operator with just a toast.
      void queryClient.invalidateQueries({ queryKey: orpc.system.updateState.queryKey() });
      if (res.started) setApplying({ target: res.targetVersion, dryRun: res.dryRun });
      else if (res.reason === "already-running") {
        toast.message(reasonText(res.reason));
      } else {
        toast.message(reasonText(res.reason));
        handleOpenChange(false);
      }
    },
    onError: (e) => toast.error(e.message ?? "Couldn't start the update"),
  });

  // A locally-started apply wins; otherwise fall back to a re-attached run.
  const active = applying ?? attached ?? null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {active ? "Updating otterdeploy" : "Update otterdeploy"}
            {status.latest && (
              <>
                <Badge variant="outline" className="font-mono">
                  {status.current}
                </Badge>
                <span className="text-muted-foreground">→</span>
                <Badge className="font-mono">{status.latest}</Badge>
              </>
            )}
            {status.dryRun && <Badge variant="secondary">dry-run</Badge>}
          </DialogTitle>
          {!active && (
            <DialogDescription>
              {status.dryRun
                ? "Dry-run mode: this simulates the full update and streams progress, but changes nothing — no images are pulled and the control plane will not restart."
                : "This pulls the new images and restarts the control plane. The dashboard will be briefly unavailable and this page will reconnect automatically when it's back."}
            </DialogDescription>
          )}
        </DialogHeader>

        {active ? (
          <UpdateProgress
            target={active.target}
            dryRun={active.dryRun}
            onDone={() => handleOpenChange(false)}
          />
        ) : (
          status.notes && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Release notes
              </div>
              <Markdown className="max-h-[280px] overflow-auto rounded-md border bg-muted/40 px-3 py-1.5">
                {status.notes}
              </Markdown>
            </div>
          )
        )}

        {!active && (
          <DialogFooter>
            {status.url && (
              <a
                href={status.url}
                target="_blank"
                rel="noreferrer"
                className="mr-auto self-center text-[12px] text-primary underline-offset-4 hover:underline"
              >
                View release on GitHub →
              </a>
            )}
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={apply.isPending} onClick={() => apply.mutate({})}>
              {apply.isPending ? "Starting…" : status.dryRun ? "Run simulation" : "Update now"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
