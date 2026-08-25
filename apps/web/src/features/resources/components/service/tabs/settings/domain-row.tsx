/**
 * One row of {@link ServiceNetworkingCard}: a single published host, its
 * inline edit (hostname + target port), its DNS-records dialog, and the
 * per-host actions. The mutations behind those actions live in
 * ./use-domain-row so this file stays about what the row looks like.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { GlobalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLoaderData } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { DnsRecordsDialog } from "@/shared/components/domains/dns-records-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { copyToClipboard } from "@/shared/lib/clipboard";

import type { PortChoice } from "./domain-row-parts";
import type { BaseDomainStatus, DomainView } from "./domains-card-parts";

import { DomainEditRow, DomainRowActions } from "./domain-row-parts";
import { DnsHint, StatusBadge } from "./domains-card-parts";
import { useDomainRow } from "./use-domain-row";

/** Same pair the server derives (packages/api/src/lib/dns-records.ts). Built
 *  from the view's own fields rather than refetched: the row already carries
 *  the token and target, and a second round trip to learn what it already
 *  knows would only add a way for the two to disagree. */
function dnsRecordsFor(domain: DomainView) {
  return [
    ...(domain.dnsTarget
      ? [{ type: "A" as const, name: domain.domain, value: domain.dnsTarget }]
      : []),
    ...(domain.verifyRecord && domain.verifyToken
      ? [{ type: "TXT" as const, name: domain.verifyRecord, value: domain.verifyToken }]
      : []),
  ];
}

export function DomainRow({
  domain,
  input,
  onSettled,
  baseDomainStatus,
  ports,
}: {
  domain: DomainView;
  input: { projectId: ProjectId; resourceId: ResourceId };
  onSettled: () => Promise<void>;
  baseDomainStatus: BaseDomainStatus | undefined;
  /** Container ports this service publishes: the edit row's port options. */
  ports: PortChoice[];
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(domain.domain);
  const [port, setPort] = useState(domain.port);
  const [dnsOpen, setDnsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Read here rather than threaded through props: the row is rendered from a
  // list and only needs the slug to build the "connect Cloudflare" link.
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });

  const url = `https://${domain.domain}`;
  const actions = useDomainRow({
    input,
    routeId: domain.id,
    domain: domain.domain,
    onSettled,
    onUpdated: () => setEditing(false),
  });

  // A custom host that isn't confirmed pointed here still needs a DNS record.
  // A generated host earns the hint only on a MEASURED miss: sslip/localhost
  // names resolve by construction and never carry a dnsCheckedAt.
  const needsDns =
    domain.source === "custom"
      ? !domain.ownershipVerified ||
        (domain.dnsState !== "pointed" && domain.dnsState !== "proxied")
      : domain.dnsCheckedAt != null && domain.dnsState === "unpointed";

  const onCopy = () => {
    void copyToClipboard(url).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  if (editing) {
    return (
      <DomainEditRow
        value={value}
        onChange={setValue}
        port={port}
        ports={ports}
        onPortChange={setPort}
        onSave={() => actions.update.run({ domain: value.trim().toLowerCase(), port })}
        saving={actions.update.pending}
        onCancel={() => {
          setValue(domain.domain);
          setPort(domain.port);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <HugeiconsIcon
          icon={GlobalIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground/70"
          aria-hidden="true"
        />
        <div className="flex min-w-0 basis-[calc(100%-1.75rem)] items-center gap-2 sm:flex-1 sm:basis-auto">
          {domain.status === "live" ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate font-mono text-[12.5px] text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground"
            >
              {domain.domain}
            </a>
          ) : (
            <span className="min-w-0 truncate font-mono text-[12.5px] text-foreground">
              {domain.domain}
            </span>
          )}

          {/* Only worth the pixels when there was a choice to get wrong. */}
          {ports.length > 1 && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              :{domain.port}
            </span>
          )}
          {domain.isPrimary && <Badge variant="default">Primary</Badge>}
          <StatusBadge domain={domain} baseDomainStatus={baseDomainStatus} />
        </div>

        <DomainRowActions
          domain={domain}
          busy={actions.busy}
          recheckPending={actions.recheck.pending}
          needsDns={needsDns}
          copied={copied}
          onCopy={onCopy}
          onRecheck={actions.recheck.run}
          onSetPrimary={actions.setPrimary.run}
          onEdit={() => setEditing(true)}
          onRemove={actions.remove.run}
          onSetEnabled={actions.setEnabled.run}
        />
      </div>

      {/* The generated host is honest about what it is instead of a modal
          asking permission to be it: sslip.io resolves without any DNS setup
          but can't hold a public certificate, so browsers will warn. */}
      {domain.source === "generated" && domain.domain.endsWith(".sslip.io") && (
        <p className="text-[11.5px] text-muted-foreground">{t("domains.sslipNote")}</p>
      )}

      {needsDns && <DnsHint domain={domain} onConfigure={() => setDnsOpen(true)} />}

      <DnsRecordsDialog
        open={dnsOpen}
        onOpenChange={setDnsOpen}
        domain={domain.domain}
        records={dnsRecordsFor(domain)}
        onAutoConfigure={actions.autoConfigure.run}
        autoConfiguring={actions.autoConfigure.pending}
        connectHref={`/${organization.slug}/settings/workspace/general`}
      />
    </div>
  );
}
