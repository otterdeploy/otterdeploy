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
import { orpc } from "@/shared/server/orpc";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      if (res.started) setApplying({ target: res.targetVersion, dryRun: res.dryRun });
      else {
        toast.message(reasonText(res.reason));
        handleOpenChange(false);
      }
    },
    onError: (e) => toast.error(e.message ?? "Couldn't start the update"),
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {applying ? "Updating otterdeploy" : "Update otterdeploy"}
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
          {!applying && (
            <DialogDescription>
              {status.dryRun
                ? "Dry-run mode: this simulates the full update and streams progress, but changes nothing — no images are pulled and the control plane will not restart."
                : "This pulls the new images and restarts the control plane. The dashboard will be briefly unavailable and this page will reconnect automatically when it's back."}
            </DialogDescription>
          )}
        </DialogHeader>

        {applying ? (
          <UpdateProgress
            target={applying.target}
            dryRun={applying.dryRun}
            onDone={() => handleOpenChange(false)}
          />
        ) : (
          status.notes && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Release notes
              </div>
              <pre className="max-h-[280px] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/80">
                {status.notes}
              </pre>
            </div>
          )
        )}

        {!applying && (
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
