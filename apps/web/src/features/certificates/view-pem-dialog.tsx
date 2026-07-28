/** Read-only PEM viewer for a stored trusted CA — copy + download. */
import { Copy01Icon, Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
                // Insecure-context safe: `navigator.clipboard` doesn't exist on
                // a self-hosted install reached over plain http://<ip>, so the
                // bare call threw before the toast. See shared/lib/clipboard.ts.
                onClick={() => {
                  void copyToClipboard(ca.pem).then((ok) =>
                    ok ? toast.success(t("certificates.pemCopied")) : toast.error("Couldn't copy"),
                  );
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
