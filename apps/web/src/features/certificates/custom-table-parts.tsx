/**
 * Row-level pieces of the Custom certificates table: the honest status badge
 * (never optimistic — "Serving at edge" only appears when the live probe's
 * leaf fingerprint matches the stored one) and the delete confirm button.
 */
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

import type { CertificateInventory, CustomCertificate } from "./data/certificates";

import { deriveCustomStatus, truncateMiddle } from "./data/certificates";

export function CustomStatusBadge({
  cert,
  inventory,
}: {
  cert: CustomCertificate;
  inventory: CertificateInventory | undefined;
}) {
  const status = deriveCustomStatus(cert, inventory);
  switch (status.kind) {
    case "serving":
      return (
        <StatusWithTip
          className="text-success"
          dot="bg-success"
          label="Serving at edge"
          tip={`Live probe confirms this certificate on ${status.domains.join(", ")}.`}
        />
      );
    case "error":
      return (
        <StatusWithTip
          className="text-destructive"
          dot="bg-destructive"
          label="Install failed"
          tip={status.detail ?? "Installation failed — replace the certificate to retry."}
        />
      );
    case "unrouted":
      return (
        <StatusWithTip
          className="text-muted-foreground"
          dot="bg-muted-foreground"
          label="No matching route"
          tip="No enabled public domain is covered by this certificate. It's stored, but nothing can serve it until a matching domain is published."
        />
      );
    case "installed-not-observed":
      return (
        <StatusWithTip
          className="text-amber-500"
          dot="bg-amber-500"
          label="Installed · not observed"
          tip={`The edge accepted the config, but the live probe hasn't seen fingerprint ${truncateMiddle(cert.fingerprint256, 20)} yet. Recheck, or expand the domain in Managed to see what's actually served.`}
        />
      );
    case "pending":
      return (
        <StatusWithTip
          className="text-sky-500"
          dot="bg-sky-500"
          label="Stored · pending install"
          tip="Stored; the next reconcile pass installs it at the edge."
        />
      );
  }
}

function StatusWithTip({
  className,
  dot,
  label,
  tip,
}: {
  className: string;
  dot: string;
  label: string;
  tip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn("inline-flex cursor-default items-center gap-1.5", className)}>
            <span className={cn("size-1.5 rounded-full", dot)} />
            {label}
          </span>
        }
      />
      <TooltipContent className="max-w-72">{tip}</TooltipContent>
    </Tooltip>
  );
}

export function DeleteCertButton({
  hostname,
  disabled,
  onConfirm,
}: {
  hostname: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            disabled={disabled}
            aria-label={`Delete certificate for ${hostname}`}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the certificate for “{hostname}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The stored chain and key are removed and the edge is re-rendered without them — the
            domain immediately falls back to its ACME or self-signed certificate. This can't be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            render={
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            }
          />
          <AlertDialogAction
            render={
              <Button
                size="sm"
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
                variant="ghost"
                onClick={onConfirm}
              >
                Delete
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
