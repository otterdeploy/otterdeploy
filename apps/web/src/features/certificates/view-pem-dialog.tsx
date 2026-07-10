/** Read-only PEM viewer for a stored trusted CA — copy + download. */
import { Copy01Icon, Download01Icon } from "@hugeicons/core-free-icons";
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

import type { TrustedCa } from "./data/certificates";

export function ViewPemDialog({
  ca,
  onClose,
  onDownload,
}: {
  ca: TrustedCa | null;
  onClose: () => void;
  onDownload: (ca: TrustedCa) => void;
}) {
  return (
    <Dialog open={ca !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>View PEM · {ca?.name}</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {ca?.subject ?? ""}
          </DialogDescription>
        </DialogHeader>
        {ca ? (
          <>
            <div className="max-h-[50vh] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground/80">
              {ca.pem.trim()}
            </div>
            <p className="font-mono text-[11px] break-all text-muted-foreground">
              SHA-256 {ca.fingerprint256}
            </p>
            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(ca.pem);
                  toast.success("PEM copied");
                }}
              >
                <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                Copy
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDownload(ca)}>
                <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
                Download
              </Button>
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
