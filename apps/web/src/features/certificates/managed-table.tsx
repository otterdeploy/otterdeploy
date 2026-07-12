/**
 * Managed tab — every enabled public domain across the org's projects with
 * the certificate the edge ACTUALLY serves for it (live probe; same
 * vocabulary as the per-project Networking → Certificates tab). Rows expand
 * to the full leaf details. Domains served by an uploaded custom cert are
 * badged, linking the two planes together.
 */
import { Fragment, useState } from "react";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/shared/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
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

import type { CertificateInventory, ProbedCertificate } from "./data/certificates";

import { PROBE_STATUS } from "./data/certificates";

export function ManagedCertsTable({
  inventory,
  isLoading,
  orgSlug,
}: {
  inventory: CertificateInventory | undefined;
  isLoading: boolean;
  orgSlug: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const certs = inventory?.certificates ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  if (certs.length === 0) {
    return (
      <Empty className="border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              strokeWidth={1.6}
              className="size-5 text-muted-foreground"
            />
          </EmptyMedia>
          <EmptyTitle>No public domains yet</EmptyTitle>
          <EmptyDescription>
            Publish a domain to a service and Caddy will issue a certificate — every enabled domain
            across the workspace shows up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-transparent">
            <TableHead className="w-8" />
            {["Domain", "Project", "Status", "Issuer", "Expires"].map((h) => (
              <TableHead
                key={h}
                className="h-9 text-[10px] font-semibold tracking-[0.06em] uppercase"
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {certs.map((c) => (
            <Fragment key={c.domain}>
              <ManagedRow
                cert={c}
                orgSlug={orgSlug}
                open={expanded === c.domain}
                onToggle={() => setExpanded(expanded === c.domain ? null : c.domain)}
              />
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function expiryText(c: ProbedCertificate): string {
  if (!c.notAfter) return "—";
  const date = new Date(c.notAfter).toLocaleDateString();
  if (c.daysRemaining === null) return date;
  if (c.daysRemaining < 0) return `${date} · expired ${-c.daysRemaining}d ago`;
  return `${date} · in ${c.daysRemaining}d`;
}

function ManagedRow({
  cert,
  orgSlug,
  open,
  onToggle,
}: {
  cert: ProbedCertificate;
  orgSlug: string;
  open: boolean;
  onToggle: () => void;
}) {
  const s = PROBE_STATUS[cert.status];
  const warnExpiry = cert.daysRemaining !== null && cert.daysRemaining < 30;
  return (
    <>
      <TableRow className="cursor-pointer text-[13px]" onClick={onToggle}>
        <TableCell className="text-muted-foreground">
          <span className={cn("inline-block transition-transform", open && "rotate-90")}>›</span>
        </TableCell>
        <TableCell className="font-mono text-foreground/90">
          <span className="inline-flex items-center gap-2">
            {cert.domain}
            {cert.customCertificateId ? (
              <Badge variant="secondary" className="font-sans text-[10px]">
                custom
              </Badge>
            ) : null}
          </span>
        </TableCell>
        <TableCell className="text-muted-foreground">
          <span className="flex flex-wrap gap-x-2 gap-y-0.5" onClick={(e) => e.stopPropagation()}>
            {cert.projects.map((p) => (
              <Link
                key={p.id}
                to="/$orgSlug/$projectSlug"
                // Route param is the branded ProjectSlug; the wire type is a
                // plain string (same pragmatic cast as git-providers/app-detail).
                params={{ orgSlug, projectSlug: p.slug as never }}
                className="hover:text-foreground hover:underline"
              >
                {p.name}
              </Link>
            ))}
          </span>
        </TableCell>
        <TableCell>
          <span className={cn("inline-flex items-center gap-1.5", s.text)}>
            <span className={cn("size-1.5 rounded-full", s.dot)} />
            {s.label}
          </span>
        </TableCell>
        <TableCell className="text-muted-foreground">{cert.issuer ?? "—"}</TableCell>
        <TableCell
          className={cn(
            "font-mono text-[12px] whitespace-nowrap text-muted-foreground",
            warnExpiry && "text-amber-500",
          )}
        >
          {expiryText(cert)}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={6} className="py-3">
            <div className="grid grid-cols-2 gap-x-10 gap-y-1 font-mono text-[12px]">
              {cert.error ? (
                <Detail k="error" v={cert.error} wide />
              ) : (
                <>
                  <Detail k="subject" v={cert.subject ?? "—"} />
                  <Detail
                    k="valid from"
                    v={cert.notBefore ? new Date(cert.notBefore).toLocaleString() : "—"}
                  />
                  <Detail k="self-signed" v={cert.selfSigned ? "yes" : "no"} />
                  <Detail k="serial" v={cert.serial ?? "—"} />
                  <Detail k="fingerprint" v={cert.fingerprint ?? "—"} wide />
                  <Detail k="SANs" v={cert.sans.length ? cert.sans.join(", ") : "—"} wide />
                </>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function Detail({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 gap-2", wide && "col-span-2")}>
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 break-all text-foreground/90">{v}</span>
    </div>
  );
}
