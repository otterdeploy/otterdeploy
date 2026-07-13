/**
 * Control-plane domain card — the address of this dashboard itself, as
 * opposed to the DomainCard above it (where deployed resources publish).
 * Platform-wide (one control plane per install), surfaced here so both
 * domain settings live on the same page.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";
import { ServerStack01Icon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

function invalidateControlPlane(organizationId: OrganizationId) {
  return queryClient.invalidateQueries({
    queryKey: orpc.organization.controlPlaneDomain.queryKey({ input: { organizationId } }),
  });
}

type DomainStatus = "unset" | "pending" | "verified";

function domainStatus(current: string, verifiedAt: unknown): DomainStatus {
  if (!current) return "unset";
  return verifiedAt ? "verified" : "pending";
}

export function ControlPlaneCard({ organizationId }: { organizationId: OrganizationId }) {
  const domainQuery = useQuery(
    orpc.organization.controlPlaneDomain.queryOptions({ input: { organizationId } }),
  );
  const setDomain = useMutation({
    ...orpc.organization.setControlPlaneDomain.mutationOptions(),
    onSuccess: async () => {
      await invalidateControlPlane(organizationId);
      toast.success("Control-plane domain saved", {
        description: "Edge proxy reconciled — the dashboard now answers on this domain.",
      });
    },
    onError: (err) => toast.error(err.message ?? "Failed to save domain"),
  });

  const current = domainQuery.data?.domain ?? "";
  const status = domainStatus(current, domainQuery.data?.verifiedAt ?? null);

  // Server-seeded default: hydrates the field until the user touches it.
  const form = useForm({
    defaultValues: { domain: current },
    onSubmit: ({ value }) => setDomain.mutate({ organizationId, domain: value.domain.trim() }),
  });

  return (
    <SettingsSection
      icon={ServerStack01Icon}
      title="Control plane"
      description={
        <>
          The domain this dashboard itself is served on — where you and your team sign in.
          Point an A record at your server, save it here, and the edge proxy answers on{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            https://&lt;domain&gt;
          </code>{" "}
          with a real certificate once verified. Deployed services use the Domain setting
          above; this one is install-wide, not per-workspace.
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium">Control-plane domain</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex items-center gap-2">
          <form.Field name="domain">
            {(field) => (
              <Input
                type="text"
                placeholder="deploy.acme.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                disabled={setDomain.isPending || domainQuery.isLoading}
                className="font-mono text-[13px]"
              />
            )}
          </form.Field>
          <form.Subscribe
            selector={(s) => s.values.domain.trim().toLowerCase() !== current.toLowerCase()}
          >
            {(dirty) => (
              <Button
                type="button"
                size="sm"
                disabled={!dirty || setDomain.isPending}
                onClick={() => void form.handleSubmit()}
              >
                {setDomain.isPending ? "Saving…" : "Save"}
              </Button>
            )}
          </form.Subscribe>
        </div>
        <StatusFooter organizationId={organizationId} status={status} current={current} />
      </div>
    </SettingsSection>
  );
}

/** Everything below the input row: the live link once verified, or the DNS
 *  records + Verify / auto-configure actions while pending. Reads the same
 *  cached queries as the parent. */
function StatusFooter({
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
  // already fetched — reads from the same cache entry.
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
      <pre className="overflow-x-auto rounded bg-warning/10 px-2 py-1.5 font-mono text-[11px] text-warning/90">
        {`Name:  ${current}\nType:  A\nValue: ${serverIp ?? "<your server IP>"}\n\nName:  _otterdeploy-verify.${current}\nType:  TXT\nValue: ${verifyToken}`}
      </pre>
      <div className="flex items-center justify-end gap-2">
        {cloudflareConfigured && <CloudflareAutoConfigureButton organizationId={organizationId} />}
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
    </div>
  );
}

function CloudflareAutoConfigureButton({ organizationId }: { organizationId: OrganizationId }) {
  const auto = useMutation({
    ...orpc.organization.autoConfigureControlPlaneDomain.mutationOptions(),
    onSuccess: async (result) => {
      await invalidateControlPlane(organizationId);
      if (result.ok) {
        toast.success("DNS configured and domain verified");
      } else if (result.verify.reason === "no-record") {
        toast.message("Records created. DNS is still propagating — try Verify in a moment.");
      } else {
        toast.error("Records created but verification didn't pass.");
      }
    },
    onError: (err) => toast.error(err.message ?? "Auto-configure failed"),
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={auto.isPending}
      onClick={() => auto.mutate({ organizationId })}
    >
      {auto.isPending ? "Configuring…" : "Auto-configure DNS"}
    </Button>
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
    status === "verified" ? "VERIFIED" : status === "pending" ? "PENDING" : "NOT SET";
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
