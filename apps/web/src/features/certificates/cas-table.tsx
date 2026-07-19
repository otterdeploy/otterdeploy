/**
 * Trusted CAs tab — inventory of uploaded CA certificates with view/download.
 *
 * HONEST SCOPE: nothing in the generated edge config consumes this pool —
 * Caddy proxies services over plain HTTP on the internal network, so there's
 * no upstream TLS verification to feed it into. The copy says so. Rows are
 * useful as a shared store (download the PEM, reference it from a project's
 * custom Caddy config).
 */
import { useState } from "react";

import { Delete02Icon, Download01Icon, ViewIcon } from "@hugeicons/core-free-icons";
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
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { TrustedCa } from "./data/certificates";

import { daysUntil, expiryLabel, truncateMiddle } from "./data/certificates";
import { ViewPemDialog } from "./view-pem-dialog";

function downloadPem(ca: TrustedCa) {
  const blob = new Blob([ca.pem], { type: "application/x-pem-file" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ca.name.replace(/[^a-z0-9-_.]+/gi, "-")}.pem`;
  a.click();
  URL.revokeObjectURL(url);
}

export function TrustedCasTable({
  cas,
  isLoading,
  canManage,
  onUpload,
}: {
  cas: TrustedCa[] | undefined;
  isLoading: boolean;
  canManage: boolean;
  onUpload: () => void;
}) {
  const [viewing, setViewing] = useState<TrustedCa | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border p-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  if (!cas || cas.length === 0) {
    return (
      <Empty className="border-dashed">
        <EmptyHeader>
          <EmptyTitle>No trusted CAs</EmptyTitle>
          <EmptyDescription>
            Store CA certificates here as a shared inventory — view and download the PEM whenever
            you need it. The generated edge config doesn't consume this pool (services are proxied
            over plain HTTP internally); reference a CA from a project's custom Caddy config if an
            upstream needs TLS verification.
          </EmptyDescription>
        </EmptyHeader>
        {canManage ? (
          <EmptyContent>
            <Button size="sm" variant="outline" className="h-8" onClick={onUpload}>
              Upload CA certificate
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Inventory only — nothing in the generated edge config consumes this pool today. Download the
        PEM or reference it from a project's custom Caddy config.
      </p>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-transparent">
              {["Name", "Subject", "Fingerprint (SHA-256)", "Expires", ""].map((h) => (
                <TableHead
                  key={h || "actions"}
                  className="h-9 text-[10px] font-semibold tracking-[0.06em] uppercase"
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {cas.map((ca) => (
              <CaRow key={ca.id} ca={ca} canManage={canManage} onView={() => setViewing(ca)} />
            ))}
          </TableBody>
        </Table>
      </div>
      <ViewPemDialog ca={viewing} onClose={() => setViewing(null)} onDownload={downloadPem} />
    </div>
  );
}

function CaRow({
  ca,
  canManage,
  onView,
}: {
  ca: TrustedCa;
  canManage: boolean;
  onView: () => void;
}) {
  const days = daysUntil(ca.notAfter);
  const del = useMutation(
    orpc.certificates.deleteCa.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.certificates.listCas.queryKey() });
        toast.success(`Removed ${ca.name}`);
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <TableRow className="text-[13px]">
      <TableCell className="font-medium text-foreground/90">{ca.name}</TableCell>
      <TableCell
        className="max-w-64 truncate font-mono text-[11px] text-muted-foreground"
        title={ca.subject ?? ""}
      >
        {ca.subject ?? "—"}
      </TableCell>
      <TableCell className="font-mono text-[11px] text-muted-foreground">
        {truncateMiddle(ca.fingerprint256, 29)}
      </TableCell>
      <TableCell
        className={cn(
          "font-mono text-[12px] whitespace-nowrap text-muted-foreground",
          days < 30 && "text-amber-500",
          days < 0 && "text-destructive",
        )}
      >
        {expiryLabel(ca.notAfter)}
      </TableCell>
      <TableCell className="text-right">
        <span className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-muted-foreground"
            onClick={onView}
          >
            <HugeiconsIcon icon={ViewIcon} strokeWidth={2} className="size-3.5" />
            View PEM
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={`Download ${ca.name} PEM`}
            onClick={() => downloadPem(ca)}
          >
            <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
          {canManage ? (
            <RemoveCaButton
              name={ca.name}
              disabled={del.isPending}
              onConfirm={() => del.mutate({ id: ca.id })}
            />
          ) : null}
        </span>
      </TableCell>
    </TableRow>
  );
}

function RemoveCaButton({
  name,
  disabled,
  onConfirm,
}: {
  name: string;
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
            aria-label={`Remove ${name}`}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove “{name}” from the CA store?</AlertDialogTitle>
          <AlertDialogDescription>
            The stored PEM is deleted. Anything referencing it (e.g. a project's custom Caddy config
            pointing at a downloaded copy) is unaffected — this only removes the inventory entry.
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
                variant="ghost"
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
                onClick={onConfirm}
              >
                Remove
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
