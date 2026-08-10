/**
 * Control-plane domain status: the vocabulary (unset / pending / verified),
 * the cache key both halves of the card write through, and everything rendered
 * below the input row: the live link once verified, or the DNS records and the
 * Verify / auto-configure actions while pending.
 *
 * Split out of ./settings-control-plane.tsx so that file stays about the card
 * and the one input it saves; the verification surface is a second concern
 * with its own two mutations and its own failure vocabulary.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { DnsRecordsDialog } from "@/shared/components/domains/dns-records-dialog";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

export function invalidateControlPlane(organizationId: OrganizationId) {
  return queryClient.invalidateQueries({
    queryKey: orpc.organization.controlPlaneDomain.queryKey({ input: { organizationId } }),
  });
}

export type DomainStatus = "unset" | "pending" | "verified";

export function domainStatus(current: string, verifiedAt: unknown): DomainStatus {
  if (!current) return "unset";
  return verifiedAt ? "verified" : "pending";
}

/** Everything below the input row: the live link once verified, or the DNS
 *  records + Verify / auto-configure actions while pending. Reads the same
 *  cached queries as the parent. */
export function StatusFooter({
  organizationId,
  status,
  current,
}: {
  organizationId: OrganizationId;
  status: DomainStatus;
  current: string;
}) {
  const domainQuery = useQuery(
    orpc.organization.controlPlaneDomain.queryOptions({ input: { organizationId } }),
  );
  // Cloudflare connection state lives on the org settings the DomainCard
  // already fetched. Reads from the same cache entry.
  const settingsQuery = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId } }),
  );
  const verifyToken = domainQuery.data?.verifyToken ?? null;

  if (status === "verified") {
    return (
      <div className="text-[11.5px] text-muted-foreground">
        Dashboard live at{" "}
        <a
          href={`https://${current}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-foreground underline underline-offset-2"
        >
          https://{current}
        </a>
        .
      </div>
    );
  }
  if (status !== "pending" || !verifyToken) return null;
  return (
    <PendingVerification
      organizationId={organizationId}
      current={current}
      verifyToken={verifyToken}
      serverIp={domainQuery.data?.serverIp ?? null}
      cloudflareConfigured={settingsQuery.data?.cloudflareTokenConfigured ?? false}
    />
  );
}

function PendingVerification({
  organizationId,
  current,
  verifyToken,
  serverIp,
  cloudflareConfigured,
}: {
  organizationId: OrganizationId;
  current: string;
  verifyToken: string;
  serverIp: string | null;
  cloudflareConfigured: boolean;
}) {
  const [dnsOpen, setDnsOpen] = useState(false);

  // Hoisted out of the old CloudflareAutoConfigureButton so the shared dialog
  // can drive it. The dialog decides whether one-click is even offered, based
  // on live detection rather than only on "is a token saved".
  const auto = useMutation({
    ...orpc.organization.autoConfigureControlPlaneDomain.mutationOptions(),
    onSuccess: async (result) => {
      await invalidateControlPlane(organizationId);
      if (result.ok) {
        toast.success("DNS configured and domain verified");
      } else if (result.verify.reason === "no-record") {
        toast.message("Records created. DNS is still propagating, so try Verify in a moment.");
      } else {
        toast.error("Records created but verification didn't pass.");
      }
    },
    onError: (err) => toast.error(err.message ?? "Auto-configure failed"),
  });

  const verify = useMutation({
    ...orpc.organization.verifyControlPlaneDomain.mutationOptions(),
    onSuccess: async (result) => {
      await invalidateControlPlane(organizationId);
      if (result.ok) {
        toast.success("Domain verified", {
          description: "The dashboard now serves a real certificate on this domain.",
        });
      } else {
        toast.error(verifyReasonMessage(result));
      }
    },
    onError: (err) => toast.error(err.message ?? "Verification failed"),
  });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 text-[11.5px] text-warning">
      <div className="font-medium">Pending verification</div>
      <div className="text-warning/85">
        The dashboard already answers on this domain with a self-signed certificate. Add
        the records below to your DNS, then hit Verify to switch to a real one.
      </div>
      <div className="flex items-center justify-end gap-2">
        {/* The records, Cloudflare detection, one-click setup and the
            proxy warning all live in the shared dialog, the same one the
            service and workspace domain surfaces open, so "add a domain"
            reads identically wherever you do it. The raw <pre> that used to
            sit here couldn't be copied, showed FQDNs where DNS UIs want
            zone-relative names, and offered Cloudflare only when a token was
            already configured. */}
        <Button type="button" size="sm" variant="outline" onClick={() => setDnsOpen(true)}>
          Configure DNS
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={verify.isPending}
          onClick={() => verify.mutate({ organizationId })}
        >
          {verify.isPending ? "Verifying…" : "Verify"}
        </Button>
      </div>

      <DnsRecordsDialog
        open={dnsOpen}
        onOpenChange={setDnsOpen}
        domain={current}
        records={[
          ...(serverIp ? [{ type: "A" as const, name: current, value: serverIp }] : []),
          {
            type: "TXT" as const,
            name: `_otterdeploy-verify.${current}`,
            value: verifyToken,
          },
        ]}
        onAutoConfigure={cloudflareConfigured ? () => auto.mutate({ organizationId }) : undefined}
        autoConfiguring={auto.isPending}
        connectHref="../settings/workspace/general"
      />
    </div>
  );
}

function verifyReasonMessage(result: {
  reason: string;
  found: string[];
  expected: string;
  errorMessage?: string;
}): string {
  switch (result.reason) {
    case "no-record":
      return "No TXT record yet. DNS can take a few minutes to propagate, so try again shortly.";
    case "value-mismatch":
      return `TXT record found but value didn't match. Expected ${result.expected}, saw ${result.found.join(", ") || "(empty)"}`;
    case "lookup-failed":
      return `DNS lookup failed: ${result.errorMessage ?? "unknown error"}`;
    case "missing-token":
      return "No verify token on file. Save the domain first.";
    default:
      return "Verification failed.";
  }
}
