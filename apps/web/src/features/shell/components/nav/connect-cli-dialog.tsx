/**
 * Connect CLI — the device-authorization flow itself is already built (the
 * `otterdeploy login` command + the `/device` approval page via better-auth's
 * deviceAuthorization plugin). This dialog just gets the user there: the exact
 * login command for this control plane + a shortcut to the approval page.
 */
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { copyToClipboard } from "@/shared/lib/clipboard";

export function ConnectCliDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const cmd = `otterdeploy login ${origin}`;

  const copy = () => {
    void copyToClipboard(cmd).then((ok) => {
      if (ok) {
        toast.success("Copied");
      } else {
        toast.error("Couldn't copy");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect the CLI</DialogTitle>
          <DialogDescription>
            Authenticate the otterdeploy CLI with this control plane.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col gap-3 text-sm">
          <li>
            <p className="text-muted-foreground">Install the CLI, then run:</p>
            <button
              type="button"
              onClick={copy}
              title="Copy"
              className="mt-1 flex w-full items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-left font-mono text-[12.5px] ring-1 ring-foreground/10 hover:bg-muted"
            >
              <span className="truncate">{cmd}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">copy</span>
            </button>
          </li>
          <li className="text-muted-foreground">
            It opens a verification page and shows a code — approve it there to finish. You can open
            that page now:
          </li>
        </ol>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
              void navigate({ to: "/device" });
            }}
          >
            Open approval page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
