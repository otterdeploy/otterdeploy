/**
 * One-time reveal of a freshly created API key. The plaintext token only exists
 * in the `create` response — once this dialog is dismissed it's gone for good,
 * so the copy action and the warning are the whole point of this screen.
 */

import { useState } from "react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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

export function RevealKeyDialog({
  apiKey,
  onClose,
}: {
  /** The plaintext token, or null when nothing to reveal. */
  apiKey: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!apiKey) return;
    void navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      toast.success("API key copied");
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Dialog
      open={apiKey !== null}
      onOpenChange={(v) => {
        if (!v) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API key created</DialogTitle>
          <DialogDescription>
            Copy it now — this is the only time the full key is shown. Store it
            somewhere safe; you won't be able to see it again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="rounded-md border bg-muted/40 px-3 py-2.5">
            <code className="block font-mono text-[12.5px] leading-relaxed break-all select-all">
              {apiKey}
            </code>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 self-end"
            onClick={copy}
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <DialogFooter className="mt-2">
          <Button
            size="sm"
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
