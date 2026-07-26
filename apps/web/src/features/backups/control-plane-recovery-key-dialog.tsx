/**
 * Recovery-key generation dialog — a shown-once secret, same discipline as
 * `ephemeral-mint-dialog.tsx`: the platform never stores the raw key (only a
 * fingerprint, see packages/api/src/lib/recovery-key.ts), so closing this
 * dialog without copying the key means it is gone for good. The operator
 * must explicitly confirm they saved it before this control plane's backups
 * count as recoverable — see control-plane-readiness.ts.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { orpc, queryClient } from "@/shared/server/orpc";

export function RecoveryKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [displayKey, setDisplayKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useMutation({
    ...orpc.backups.controlPlane.recoveryKey.generate.mutationOptions(),
    onSuccess: (result) => setDisplayKey(result.displayKey),
    onError: (err) => toast.error(err.message ?? "Failed to generate a recovery key"),
  });

  const confirmExported = useMutation({
    ...orpc.backups.controlPlane.recoveryKey.confirmExported.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.backups.controlPlane.readiness.queryKey({ input: {} }),
      });
      toast.success("Recovery key confirmed exported");
      setOpen(false);
    },
    onError: (err) => toast.error(err.message ?? "Failed to confirm export"),
  });

  const setOpen = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setDisplayKey(null);
      setCopied(false);
    }
  };

  const onCopy = () => {
    if (!displayKey) return;
    void copyToClipboard(displayKey).then((ok) => {
      if (ok) setCopied(true);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        {displayKey ? (
          <>
            <DialogHeader>
              <DialogTitle>Save this recovery key now</DialogTitle>
              <DialogDescription>
                This is the ONLY time this key is shown. It never touches the platform's own
                storage, so if you lose it and this server dies, encrypted control-plane backups
                cannot be decrypted — save it in a password manager or print it and lock it away.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/40 p-3">
              <code className="block break-all font-mono text-[13px] tracking-wide">
                {displayKey}
              </code>
            </div>
            <Button variant="outline" size="sm" onClick={onCopy} className="self-start">
              {copied ? "Copied" : "Copy key"}
            </Button>
            <DialogFooter>
              <Button
                onClick={() => confirmExported.mutate({})}
                disabled={confirmExported.isPending}
              >
                {confirmExported.isPending ? "Confirming…" : "I've saved it — confirm"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Generate a recovery key</DialogTitle>
              <DialogDescription>
                A 256-bit key, independent of this server's encryption keys, used to encrypt the
                whole-control-plane backup archive. Generating a new key replaces the old one's
                fingerprint — archives already encrypted under the old key still decrypt with it,
                but the readiness check will only recognize the new one.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => generate.mutate({})} disabled={generate.isPending}>
                {generate.isPending ? "Generating…" : "Generate"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
