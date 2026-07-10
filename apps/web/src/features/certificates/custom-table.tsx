/**
 * Custom tab — operator-uploaded PEM certificates. Status is never
 * optimistic: "Serving at edge" only appears when the live probe's leaf
 * fingerprint matches the stored one; install failures surface their real
 * error; a cert no enabled domain points at says so.
 */
import { useState } from "react";

import { Delete02Icon, UploadCircle01Icon } from "@hugeicons/core-free-icons";
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
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { CertificateInventory, CustomCertificate } from "./data/certificates";

import {
  daysUntil,
  deriveCustomStatus,
  expiryLabel,
  invalidateCertificates,
  timeAgo,
  truncateMiddle,
} from "./data/certificates";
import { UploadCertDialog } from "./upload-cert-dialog";

export function CustomCertsTable({
  customs,
  inventory,
  isLoading,
  canManage,
  onUpload,
}: {
  customs: CustomCertificate[] | undefined;
  inventory: CertificateInventory | undefined;
  isLoading: boolean;
  canManage: boolean;
  onUpload: () => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border p-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  if (!customs || customs.length === 0) {
    return (
      <Empty className="border-dashed">
        <EmptyHeader>
          <EmptyTitle>No custom certificates</EmptyTitle>
          <EmptyDescription>
            Upload a PEM chain and private key to serve your own certificate for a domain instead of
            the ACME-issued one. Custom certificates are not auto-renewed.
          </EmptyDescription>
        </EmptyHeader>
        {canManage ? (
          <EmptyContent>
            <Button size="sm" className="h-8" onClick={onUpload}>
              <HugeiconsIcon icon={UploadCircle01Icon} strokeWidth={2} />
              Upload custom certificate
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Uploaded PEM bundles · not auto-renewed · private keys are encrypted at rest and never
        shown.
      </p>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-transparent">
              {["Hostname", "Issuer", "SANs", "Expires", "Key", "Status", "Uploaded", ""].map(
                (h, i) => (
                  <TableHead
                    key={i}
                    className="h-9 text-[10px] font-semibold tracking-[0.06em] uppercase"
                  >
                    {h}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {customs.map((c) => (
              <CustomRow key={c.id} cert={c} inventory={inventory} canManage={canManage} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CustomRow({
  cert,
  inventory,
  canManage,
}: {
  cert: CustomCertificate;
  inventory: CertificateInventory | undefined;
  canManage: boolean;
}) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const days = daysUntil(cert.notAfter);

  const del = useMutation(
    orpc.certificates.deleteCustom.mutationOptions({
      onSuccess: () => {
        invalidateCertificates();
        toast.success(`Deleted certificate for ${cert.hostname}`, {
          description: "The domain falls back to its ACME / self-signed certificate.",
        });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <TableRow className="text-[13px]">
      <TableCell className="font-mono text-foreground/90">{cert.hostname}</TableCell>
      <TableCell className="max-w-40 truncate text-muted-foreground" title={cert.issuer ?? ""}>
        {cert.issuer ?? "—"}
      </TableCell>
      <TableCell>
        <span className="flex max-w-56 flex-wrap gap-1">
          {cert.sans.map((s) => (
            <span
              key={s}
              className="rounded-sm bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </span>
      </TableCell>
      <TableCell
        className={cn(
          "font-mono text-[12px] whitespace-nowrap text-muted-foreground",
          days < 30 && "text-amber-500",
          days < 0 && "text-destructive",
        )}
      >
        {expiryLabel(cert.notAfter)}
      </TableCell>
      <TableCell>
        {cert.keyAlg ? (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {cert.keyAlg}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        <CustomStatusBadge cert={cert} inventory={inventory} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {timeAgo(cert.updatedAt)}
        {cert.uploadedBy ? (
          <span className="text-muted-foreground/70"> · {cert.uploadedBy}</span>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        {canManage ? (
          <span className="inline-flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-muted-foreground"
              onClick={() => setReplaceOpen(true)}
            >
              <HugeiconsIcon icon={UploadCircle01Icon} strokeWidth={2} className="size-3.5" />
              Replace
            </Button>
            <DeleteCertButton
              hostname={cert.hostname}
              disabled={del.isPending}
              onConfirm={() => del.mutate({ id: cert.id })}
            />
          </span>
        ) : null}
        <UploadCertDialog open={replaceOpen} onOpenChange={setReplaceOpen} replaceTarget={cert} />
      </TableCell>
    </TableRow>
  );
}

function CustomStatusBadge({
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

function DeleteCertButton({
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
