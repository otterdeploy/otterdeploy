/**
 * One row of {@link ServiceNetworkingCard}: a single published host.
 *
 * The row reads globe, host, primary marker, then the switch, Copy URL, Remove
 * and ⋯. The globe carries the host's one status (./domain-status) and opens a
 * card with the details and the one action that helps (./domain-status-card),
 * so no status chips or DNS boxes sit on the row itself. Inline edit (hostname
 * + target port) replaces the row while it is open. The mutations behind every
 * action live in ./use-domain-row.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useLoaderData } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { DnsRecordsDialog } from "@/shared/components/domains/dns-records-dialog";
import { cn } from "@/shared/lib/utils";

import type { PortChoice } from "./domain-row-parts";
import type { BaseDomainStatus, DomainView } from "./domains-card-parts";

import { DomainRowActions } from "./domain-row-actions";
import { DomainEditRow } from "./domain-row-parts";
import { DomainGlobe } from "./domain-status-card";
import { dnsRecordsFor } from "./domain-status-parts";
import { useDomainRow } from "./use-domain-row";

export function DomainRow({
  domain,
  input,
  onSettled,
  baseDomainStatus,
  ports,
  multiple,
}: {
  domain: DomainView;
  input: { projectId: ProjectId; resourceId: ResourceId };
  onSettled: () => Promise<void>;
  baseDomainStatus: BaseDomainStatus | undefined;
  /** Container ports this service publishes: the edit row's port options. */
  ports: PortChoice[];
  /** More than one host: only then is "primary" a choice worth marking. */
  multiple: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(domain.domain);
  const [port, setPort] = useState(domain.port);
  const [dnsOpen, setDnsOpen] = useState(false);
  // Read here rather than threaded through props: the row is rendered from a
  // list and only needs the slug for its links.
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });

  const actions = useDomainRow({
    input,
    routeId: domain.id,
    domain: domain.domain,
    onSettled,
    onUpdated: () => setEditing(false),
  });

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
    <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-2">
      <DomainGlobe
        domain={domain}
        baseDomainStatus={baseDomainStatus}
        orgSlug={organization.slug}
        recheck={actions.recheck}
        onResume={() => actions.setEnabled.run(true)}
        onConfigureDns={() => setDnsOpen(true)}
        busy={actions.busy}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {domain.status === "live" ? (
          <a
            href={`https://${domain.domain}`}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate font-mono text-[12.5px] text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground"
          >
            {domain.domain}
          </a>
        ) : (
          <span
            className={cn(
              "min-w-0 truncate font-mono text-[12.5px]",
              domain.status === "paused" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {domain.domain}
          </span>
        )}
        {/* Only worth the pixels when there was a choice to get wrong. */}
        {ports.length > 1 && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            :{domain.port}
          </span>
        )}
        {multiple && domain.isPrimary ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {t("domains.primaryMarker")}
          </span>
        ) : null}
      </div>

      <DomainRowActions
        domain={domain}
        busy={actions.busy}
        onSetEnabled={actions.setEnabled.run}
        onSetPrimary={actions.setPrimary.run}
        onEdit={() => setEditing(true)}
        onRemove={actions.remove.run}
      />

      <DnsRecordsDialog
        open={dnsOpen}
        onOpenChange={setDnsOpen}
        domain={domain.domain}
        records={dnsRecordsFor(domain)}
        onAutoConfigure={actions.autoConfigure.run}
        autoConfiguring={actions.autoConfigure.pending}
        connectHref={`/${organization.slug}/workspace/domains`}
      />
    </div>
  );
}
