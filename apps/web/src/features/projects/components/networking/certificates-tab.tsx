/**
 * Certificates tab (Networking). Shows the live TLS certificate Caddy serves
 * for each of the project's enabled HTTP domains — issuer, expiry, SANs,
 * serial, fingerprint — by probing the edge over TLS (server-side, see
 * lib/cert-probe). Live data, re-probed on demand; no fake/seeded rows.
 */

import { useState } from "react";

import { CheckmarkCircle02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
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

type Certificate = Awaited<
  ReturnType<typeof orpc.project.proxyRoute.certificates.call>
>["certificates"][number];
type Status = Certificate["status"];

const STATUS: Record<Status, { label: string; dot: string; text: string }> = {
  valid: { label: "Valid", dot: "bg-success", text: "text-success" },
  expiring: { label: "Expiring soon", dot: "bg-amber-500", text: "text-amber-500" },
  expired: { label: "Expired", dot: "bg-destructive", text: "text-destructive" },
  internal: { label: "Self-signed", dot: "bg-sky-500", text: "text-sky-500" },
  error: { label: "Unreachable", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

function expiryLabel(c: Certificate): string {
  if (!c.notAfter) return "—";
  const date = new Date(c.notAfter).toLocaleDateString();
  if (c.daysRemaining === null) return date;
  if (c.daysRemaining < 0) return `${date} · expired ${-c.daysRemaining}d ago`;
  return `${date} · in ${c.daysRemaining}d`;
}

export function CertificatesTab({ projectId }: { projectId: string }) {
  const query = useQuery(
    orpc.project.proxyRoute.certificates.queryOptions({ input: { projectId } }),
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  if (query.isError) {
    return (
      <ErrorState
        title="Couldn't read certificates"
        message={query.error.message}
        onRetry={() => query.refetch()}
      />
    );
  }

  const data = query.data;
  const certs = data?.certificates ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-muted-foreground">
          The certificate Caddy is currently serving for each public domain, probed live at the
          edge.
        </p>
        <div className="flex-1" />
        {data ? (
          <span className="font-mono text-[11px] text-muted-foreground/70">
            via {data.edgeHost} · {new Date(data.probedAt).toLocaleTimeString()}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={query.isFetching}
          onClick={() =>
            queryClient.invalidateQueries({
              queryKey: orpc.project.proxyRoute.certificates.queryKey({
                input: { projectId },
              }),
            })
          }
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            strokeWidth={2}
            className={cn("size-3.5", query.isFetching && "animate-spin")}
          />
          Recheck
        </Button>
      </div>

      {query.isLoading ? (
        <CertSkeleton />
      ) : certs.length === 0 ? (
        <Empty className="border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={1.6}
                className="size-5 text-muted-foreground"
              />
            </EmptyMedia>
            <EmptyTitle>No certificates yet</EmptyTitle>
            <EmptyDescription>
              Publish a domain to a service and Caddy will issue a certificate — it'll show up here
              once it's serving.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-transparent">
                <TableHead className="w-8" />
                {["Domain", "Status", "Issuer", "Expires"].map((h) => (
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
                <CertRow
                  key={c.domain}
                  cert={c}
                  open={expanded === c.domain}
                  onToggle={() => setExpanded(expanded === c.domain ? null : c.domain)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CertRow({
  cert,
  open,
  onToggle,
}: {
  cert: Certificate;
  open: boolean;
  onToggle: () => void;
}) {
  const s = STATUS[cert.status];
  return (
    <>
      <TableRow className="cursor-pointer text-[13px]" onClick={onToggle}>
        <TableCell className="text-muted-foreground">
          <span className={cn("inline-block transition-transform", open && "rotate-90")}>›</span>
        </TableCell>
        <TableCell className="font-mono text-foreground/90">{cert.domain}</TableCell>
        <TableCell>
          <span className={cn("inline-flex items-center gap-1.5", s.text)}>
            <span className={cn("size-1.5 rounded-full", s.dot)} />
            {s.label}
          </span>
        </TableCell>
        <TableCell className="text-muted-foreground">{cert.issuer ?? "—"}</TableCell>
        <TableCell className="font-mono text-[12px] whitespace-nowrap text-muted-foreground">
          {expiryLabel(cert)}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={5} className="py-3">
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

function CertSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}
