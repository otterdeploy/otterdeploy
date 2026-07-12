/**
 * One-time reveal of a freshly created API key. The plaintext token only exists
 * in the `create` response — once this dialog is dismissed it's gone for good,
 * so the copy action and the warning are the whole point of this screen. The
 * "stored securely" checkbox gates every way out (Done, backdrop, Esc): the
 * operator must actively acknowledge before the secret disappears forever.
 */

import { useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { copyToClipboard } from "@/shared/lib/clipboard";

export function RevealKeyDialog({
  apiKey,
  onClose,
}: {
  /** The plaintext token, or null when nothing to reveal. */
  apiKey: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const close = () => {
    setCopied(false);
    setConfirmed(false);
    onClose();
  };

  const copy = () => {
    if (!apiKey) return;
    void copyToClipboard(apiKey).then((ok) => {
      if (!ok) {
        toast.error("Couldn't copy API key");
        return;
      }
      setCopied(true);
      toast.success("API key copied");
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Dialog
      open={apiKey !== null}
      onOpenChange={(v) => {
        // Block backdrop/Esc dismissal until the operator confirms they've
        // stored the key — this is the last time it can ever be seen.
        if (!v && confirmed) close();
      }}
    >
      {/* No X button: the only way out is Done, unlocked by the checkbox. */}
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>API key created</DialogTitle>
          <DialogDescription>
            Copy it now — this is the only time the full key is shown. Store it somewhere safe; you
            won't be able to see it again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="rounded-md border bg-muted/40 px-3 py-2.5">
            <code className="block font-mono text-[12.5px] leading-relaxed break-all select-all">
              {apiKey}
            </code>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 self-end" onClick={copy}>
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <Label className="mt-1 flex cursor-pointer items-center gap-2 text-[13px] font-normal">
          <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />I have
          stored this key securely.
        </Label>

        <DialogFooter className="mt-2">
          <Button size="sm" disabled={!confirmed} onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
