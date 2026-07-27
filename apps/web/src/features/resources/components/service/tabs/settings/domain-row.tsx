/**
 * One row of {@link ServiceDomainsCard}: a single published host, with its
 * inline rename, its DNS-records dialog, and the verify / recheck /
 * auto-configure actions that act on that host alone.
 *
 * Split out of ./domains-card so the card stays about the list and the add
 * form — this owns everything scoped to a single domain.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { useLoaderData } from "@tanstack/react-router";
import { toast } from "sonner";

import { DnsRecordsDialog } from "@/shared/components/domains/dns-records-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { orpc } from "@/shared/server/orpc";

import type { BaseDomainStatus, DomainView } from "./domains-card-parts";

import { DnsHint, DomainEditRow, DomainRowActions, StatusBadge } from "./domains-card-parts";

export function DomainRow({
  domain,
  input,
  onSettled,
  baseDomainStatus,
}: {
  domain: DomainView;
  input: { projectId: ProjectId; resourceId: ResourceId };
  onSettled: () => Promise<void>;
  baseDomainStatus: BaseDomainStatus | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(domain.domain);
  const [dnsOpen, setDnsOpen] = useState(false);
  // Read here rather than threaded through props: the row is rendered from a
  // list and only needs the slug to build the "connect Cloudflare" link.
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });

  const route = { ...input, routeId: domain.id };

  // Same pair the server derives (packages/api/src/lib/dns-records.ts). Built
  // from the view's own fields rather than refetched: the row already carries
  // the token and target, and a second round trip to learn what it already
  // knows would only add a way for the two to disagree.
  const dnsRecords = [
    ...(domain.dnsTarget
      ? [{ type: "A" as const, name: domain.domain, value: domain.dnsTarget }]
      : []),
    ...(domain.verifyRecord && domain.verifyToken
      ? [{ type: "TXT" as const, name: domain.verifyRecord, value: domain.verifyToken }]
      : []),
  ];

  const autoConfigure = useMutation({
    ...orpc.service.domains.autoConfigureDns.mutationOptions(),
    onSuccess: () => {
      toast.success(`DNS records created for ${domain.domain}`);
      // Records exist now, so the ownership check can actually pass — run it
      // rather than making the operator find Recheck themselves.
      recheck.mutate(route);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't configure DNS automatically"),
  });

  const recheck = useMutation({
    ...orpc.service.domains.recheck.mutationOptions(),
    onSuccess: (res) => {
      if (!res.ownershipVerified) {
        toast.warning(`TXT ownership proof for ${res.domain} was not found yet`);
      } else if (res.dnsState === "pointed")
        toast.success(`${res.domain} points here — certificate will issue`);
      else if (res.dnsState === "proxied") toast.success(`${res.domain} is proxied via Cloudflare`);
      else toast.warning(`${res.domain} isn't pointed here yet`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "DNS check failed"),
    onSettled,
  });

  const setPrimary = useMutation({
    ...orpc.service.domains.setPrimary.mutationOptions(),
    onSuccess: () => toast.success(`${domain.domain} is now the primary domain`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to set primary"),
    onSettled,
  });

  const remove = useMutation({
    ...orpc.service.domains.remove.mutationOptions(),
    onSuccess: () => toast.success(`Removed ${domain.domain}`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to remove domain"),
    onSettled,
  });

  const update = useMutation({
    ...orpc.service.domains.update.mutationOptions(),
    onSuccess: () => {
      setEditing(false);
      toast.success("Domain updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update domain"),
    onSettled,
  });

  const busy = recheck.isPending || setPrimary.isPending || remove.isPending || update.isPending;
  // Custom hosts that aren't confirmed pointed here still need a DNS record.
  const needsDns =
    domain.source === "custom" &&
    (!domain.ownershipVerified || (domain.dnsState !== "pointed" && domain.dnsState !== "proxied"));

  if (editing) {
    return (
      <DomainEditRow
        value={value}
        onChange={setValue}
        onSave={() => update.mutate({ ...route, domain: value.trim().toLowerCase() })}
        saving={update.isPending}
        onCancel={() => {
          setValue(domain.domain);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 basis-full items-center gap-2 sm:flex-1 sm:basis-auto">
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
            <span className="min-w-0 truncate font-mono text-[12.5px] text-foreground">
              {domain.domain}
            </span>
          )}

          {domain.isPrimary && <Badge variant="default">Primary</Badge>}
          <StatusBadge domain={domain} baseDomainStatus={baseDomainStatus} />
        </div>

        <DomainRowActions
          domain={domain}
          busy={busy}
          recheckPending={recheck.isPending}
          needsDns={needsDns}
          onRecheck={() => recheck.mutate(route)}
          onSetPrimary={() => setPrimary.mutate(route)}
          onEdit={() => setEditing(true)}
          onRemove={() => remove.mutate(route)}
        />
      </div>

      {needsDns && <DnsHint domain={domain} onConfigure={() => setDnsOpen(true)} />}

      <DnsRecordsDialog
        open={dnsOpen}
        onOpenChange={setDnsOpen}
        domain={domain.domain}
        records={dnsRecords}
        onAutoConfigure={() => autoConfigure.mutate(route)}
        autoConfiguring={autoConfigure.isPending}
        connectHref={`/${organization.slug}/settings/workspace/general`}
      />
    </div>
  );
}
