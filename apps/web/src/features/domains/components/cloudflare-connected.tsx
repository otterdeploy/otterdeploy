/**
 * The connected state of Settings → Domains' Cloudflare row: the zone by name
 * (read live with the stored token, which also proves the token still works
 * right now), and the one action connecting buys: writing the base domain's
 * records.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

import { invalidateBaseDomain } from "../data/use-base-domain";
import { writeResultMessage } from "../lib/base-domain-copy";
import { DnsStatusPill } from "./dns-status-pill";

type ZoneView = Awaited<ReturnType<typeof orpc.organization.cloudflareZone.call>>;

function tokenPill(zone: ZoneView | undefined, checking: boolean) {
  if (checking || !zone) return <DnsStatusPill tone="muted" label="Checking" />;
  switch (zone.token) {
    case "ok":
      return <DnsStatusPill tone="ok" label="Token works" />;
    case "rejected":
      return <DnsStatusPill tone="bad" label="Token rejected" />;
    case "unreachable":
      return <DnsStatusPill tone="muted" label="Couldn't reach Cloudflare" />;
    case "error":
      return <DnsStatusPill tone="warn" label="Cloudflare error" />;
    case "not-connected":
      return null;
  }
}

function zoneLine(zone: ZoneView | undefined, zoneId: string | null) {
  // The name is read live from Cloudflare. When it can't be (the token was
  // refused, Cloudflare unreachable), the stored id is all there is.
  const label = zone?.name ?? zoneId ?? "(none)";
  if (zone?.token === "rejected") {
    return (
      <>
        Zone <span className="font-mono">{label}</span>. Cloudflare rejected the saved token (
        <span className="font-mono">{zone.message}</span>). It was probably revoked or has expired.
      </>
    );
  }
  if (zone && (zone.token === "unreachable" || zone.token === "error")) {
    return (
      <>
        Zone <span className="font-mono">{label}</span>. Couldn&apos;t read it from Cloudflare just
        now: <span className="font-mono">{zone.message}</span>
      </>
    );
  }
  return (
    <>
      Zone <span className="font-mono">{label}</span>
    </>
  );
}

export function CloudflareConnected({
  organizationId,
  zone,
  zoneId,
  checking,
  canManage,
  canWrite,
  replacing,
  onReplace,
}: {
  organizationId: OrganizationId;
  zone: ZoneView | undefined;
  zoneId: string | null;
  checking: boolean;
  canManage: boolean;
  canWrite: boolean;
  replacing: boolean;
  onReplace: () => void;
}) {
  const disconnect = useMutation({
    ...orpc.organization.setCloudflareConfig.mutationOptions(),
    onSuccess: async () => {
      await invalidateBaseDomain(organizationId);
      toast.success("Cloudflare disconnected");
    },
    onError: (err) => toast.error(err.message ?? "Disconnect failed"),
  });
  const write = useMutation({
    ...orpc.organization.autoConfigureBaseDomain.mutationOptions(),
    onSuccess: async (result) => {
      await invalidateBaseDomain(organizationId);
      // One-click never overwrites an existing apex or wildcard record, so
      // say which one it left alone.
      const message = writeResultMessage({
        baseDomain: result.settings.baseDomain ?? "",
        verified: result.ok,
        apex: result.apex,
        wildcard: result.wildcard,
      });
      if (message.tone === "warning") toast.warning(message.text);
      else toast.success(message.text);
    },
    onError: (err) => toast.error(err.message ?? "Couldn't write the DNS records"),
  });
  const rejected = zone?.token === "rejected";

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">Connected</span>
          {tokenPill(zone, checking)}
        </div>
        <span className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
          {zoneLine(zone, zoneId)}
          {!canManage && " Only workspace owners and admins can change this."}
        </span>
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate({ organizationId, token: "", zoneId: null })}
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
          {rejected ? (
            <Button type="button" size="sm" variant="outline" onClick={onReplace}>
              {replacing ? "Cancel" : "Replace token"}
            </Button>
          ) : canWrite ? (
            <Button
              type="button"
              size="sm"
              disabled={write.isPending}
              onClick={() => write.mutate({ organizationId })}
            >
              {write.isPending ? "Writing…" : "Write DNS records"}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
