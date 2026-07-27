import type { OrganizationId } from "@otterdeploy/shared/id";
import { EarthIcon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { DnsRecordsDialog } from "@/shared/components/domains/dns-records-dialog";
import { SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

function invalidateSettings(organizationId: OrganizationId) {
  return queryClient.invalidateQueries({
    queryKey: orpc.organization.settings.queryKey({
      input: { organizationId },
    }),
  });
}

type DomainStatus = "unset" | "pending" | "verified";

function domainStatus(current: string, verifiedAt: unknown): DomainStatus {
  if (!current) return "unset";
  return verifiedAt ? "verified" : "pending";
}

export function DomainCard({ organizationId }: { organizationId: OrganizationId }) {
  const settingsQuery = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId } }),
  );
  const setBaseDomain = useMutation({
    ...orpc.organization.setBaseDomain.mutationOptions(),
    onSuccess: async () => {
      await invalidateSettings(organizationId);
      toast.success("Domain saved");
    },
    onError: (err) => toast.error(err.message ?? "Failed to save domain"),
  });

  const current = settingsQuery.data?.baseDomain ?? "";

  // Server-seeded default: hydrates the field until the user touches it.
  const form = useForm({
    defaultValues: { baseDomain: current },
    onSubmit: ({ value }) =>
      setBaseDomain.mutate({ organizationId, baseDomain: value.baseDomain.trim() }),
  });

  const verifiedAt = settingsQuery.data?.baseDomainVerifiedAt ?? null;
  const verifyToken = settingsQuery.data?.baseDomainVerifyToken ?? null;
  const status = domainStatus(current, verifiedAt);

  return (
    <SettingsSection
      icon={EarthIcon}
      title="Domain"
      description={
        <>
          The apex domain your resources are published under. A service{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">web</code> in
          project{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">myproj</code> lands
          at{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            web-myproj.apps.&lt;baseDomain&gt;
          </code>
          . Leave blank to use the platform default (sslip.io fallback when no domain is set).
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium">Base domain</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex items-center gap-2">
          <form.Field name="baseDomain">
            {(field) => (
              <Input
                type="text"
                placeholder="acme.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                disabled={setBaseDomain.isPending || settingsQuery.isLoading}
                className="font-mono text-[13px]"
              />
            )}
          </form.Field>
          <form.Subscribe
            selector={(s) => s.values.baseDomain.trim().toLowerCase() !== current.toLowerCase()}
          >
            {(dirty) => (
              <Button
                type="button"
                size="sm"
                disabled={!dirty || setBaseDomain.isPending}
                onClick={() => void form.handleSubmit()}
              >
                {setBaseDomain.isPending ? "Saving…" : "Save"}
              </Button>
            )}
          </form.Subscribe>
        </div>
        {status === "pending" && verifyToken && (
          <PendingVerification
            organizationId={organizationId}
            current={current}
            verifyToken={verifyToken}
            cloudflareConfigured={settingsQuery.data?.cloudflareTokenConfigured ?? false}
          />
        )}
      </div>
    </SettingsSection>
  );
}

function PendingVerification({
  organizationId,
  current,
  verifyToken,
  cloudflareConfigured,
}: {
  organizationId: OrganizationId;
  current: string;
  verifyToken: string;
  cloudflareConfigured: boolean;
}) {
  const [dnsOpen, setDnsOpen] = useState(false);

  // Hoisted from the old CloudflareAutoConfigureButton so the shared dialog
  // drives it — detection decides whether one-click is offered at all.
  const auto = useMutation({
    ...orpc.organization.autoConfigureBaseDomain.mutationOptions(),
    onSuccess: async () => {
      await invalidateSettings(organizationId);
      toast.success("DNS configured");
    },
    onError: (err) => toast.error(err.message ?? "Auto-configure failed"),
  });

  const verifyBaseDomain = useMutation({
    ...orpc.organization.verifyBaseDomain.mutationOptions(),
    onSuccess: async (result) => {
      await invalidateSettings(organizationId);
      if (result.ok) {
        toast.success("Domain verified");
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
        Add a TXT record to your DNS so we can prove you own this domain. Once
        the record propagates, hit Verify.
      </div>
      <div className="flex items-center justify-end gap-2">
        {/* Records, Cloudflare detection, one-click setup and the proxy
            warning live in the shared dialog — the same one the service and
            control-plane surfaces open. */}
        <Button type="button" size="sm" variant="outline" onClick={() => setDnsOpen(true)}>
          Configure DNS
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={verifyBaseDomain.isPending}
          onClick={() => verifyBaseDomain.mutate({ organizationId })}
        >
          {verifyBaseDomain.isPending ? "Verifying…" : "Verify"}
        </Button>
      </div>

      <DnsRecordsDialog
        open={dnsOpen}
        onOpenChange={setDnsOpen}
        domain={current}
        records={[
          {
            type: "TXT" as const,
            name: `_otterdeploy-verify.${current}`,
            value: verifyToken,
          },
        ]}
        onAutoConfigure={cloudflareConfigured ? () => auto.mutate({ organizationId }) : undefined}
        autoConfiguring={auto.isPending}
        connectHref="./workspace/general"
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
      return "No TXT record yet. DNS can take a few minutes to propagate — try again shortly.";
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

function StatusBadge({ status }: { status: DomainStatus }) {
  const label =
    status === "verified"
      ? "VERIFIED"
      : status === "pending"
        ? "PENDING"
        : "NOT SET";
  const tone =
    status === "verified"
      ? "bg-success/15 text-success border-success/30"
      : status === "pending"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-muted text-muted-foreground border-border/60";
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium uppercase ${tone}`}
    >
      {label}
    </span>
  );
}
