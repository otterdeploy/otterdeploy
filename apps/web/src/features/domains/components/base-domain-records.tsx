/**
 * The two records a base domain needs, inline in its card, each with what DNS
 * says about it right now. The wildcard is the one every service hostname
 * resolves through; the page never mentioned it before, so a domain could
 * read VERIFIED while nothing under it resolved.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { Alert02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { RecordsTable, type DnsRecordRow } from "@/shared/components/domains/dns-records-dialog";
import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

import { invalidateBaseDomain } from "../data/use-base-domain";
import { txtStatus, wildcardStatus, wildcardWarning } from "../lib/base-domain-copy";
import { DnsStatusPill } from "./dns-status-pill";

type BaseDomainDns = Awaited<ReturnType<typeof orpc.organization.checkBaseDomainDns.call>>;

const PURPOSE = {
  wildcard: "Sends every service hostname to this server.",
  verify: "Proves you own the domain, so certificates can be issued.",
} as const;

export function BaseDomainRecords({
  organizationId,
  baseDomain,
  dns,
  checking,
  canManage,
  cloudflareConnected,
}: {
  organizationId: OrganizationId;
  baseDomain: string;
  dns: BaseDomainDns | undefined;
  checking: boolean;
  canManage: boolean;
  cloudflareConnected: boolean;
}) {
  // "Check DNS" re-reads both records. For someone who may change the domain
  // it also runs verification, which is what stamps the domain verified (and
  // adds a missing wildcard through a connected Cloudflare).
  const verify = useMutation({
    ...orpc.organization.verifyBaseDomain.mutationOptions(),
    onSettled: () => invalidateBaseDomain(organizationId),
    onError: (err) => toast.error(err.message ?? "Couldn't check DNS"),
  });
  const busy = checking || verify.isPending;
  const check = () =>
    canManage ? verify.mutate({ organizationId }) : void invalidateBaseDomain(organizationId);

  const records = dns?.baseDomain === baseDomain ? dns.records : [];
  const byPurpose = new Map(records.map((r) => [`${r.type}:${r.name}`, r.purpose]));
  const purposeOf = (row: DnsRecordRow) => byPurpose.get(`${row.type}:${row.name}`);

  const status = (row: DnsRecordRow) => {
    const purpose = purposeOf(row);
    if (busy || !dns) return <DnsStatusPill tone="muted" label="Checking" />;
    if (purpose === "wildcard" && dns.wildcard) {
      return <DnsStatusPill {...wildcardStatus(dns.wildcard)} />;
    }
    if (purpose === "verify" && dns.txt) return <DnsStatusPill {...txtStatus(dns.txt)} />;
    return null;
  };

  const warning =
    dns?.wildcard && !busy
      ? wildcardWarning({ baseDomain, serverIp: dns.serverIp, check: dns.wildcard })
      : null;

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-foreground">DNS records</span>
          <p className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
            Add both at your DNS provider
            {dns?.zone ? (
              <>
                {" "}
                for <span className="font-mono">{dns.zone}</span>
              </>
            ) : null}
            .{" "}
            {cloudflareConnected
              ? "Cloudflare is connected below, so we can write them for you."
              : "On Cloudflare? Connect it below and we'll add them for you."}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={check}>
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} data-icon="inline-start" />
          {busy ? "Checking…" : "Check DNS"}
        </Button>
      </div>

      <RecordsTable
        records={records}
        caption={(row) => {
          const purpose = purposeOf(row);
          return purpose ? PURPOSE[purpose] : null;
        }}
        status={status}
      />

      {dns && !dns.serverIp ? (
        <Notice>
          This install has no public IP set, so there is no address for the wildcard record yet. Set
          it under Instance settings.
        </Notice>
      ) : null}
      {warning ? <Notice tone="bad">{warning}</Notice> : null}
    </div>
  );
}

function Notice({ children, tone = "warn" }: { children: string; tone?: "warn" | "bad" }) {
  return (
    <p
      className={
        tone === "bad"
          ? "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
          : "flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] text-warning"
      }
    >
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
