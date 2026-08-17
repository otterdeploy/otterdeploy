/**
 * Control-plane domain card: the address of this dashboard itself, as
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
import { orpc } from "@/shared/server/orpc";

import {
  domainStatus,
  invalidateControlPlane,
  StatusFooter,
  type DomainStatus,
} from "./settings-control-plane-status";

export function ControlPlaneCard({ organizationId }: { organizationId: OrganizationId }) {
  const domainQuery = useQuery(
    orpc.organization.controlPlaneDomain.queryOptions({ input: { organizationId } }),
  );
  const setDomain = useMutation({
    ...orpc.organization.setControlPlaneDomain.mutationOptions(),
    onSuccess: async () => {
      await invalidateControlPlane(organizationId);
      toast.success("Control-plane domain saved", {
        description: "Edge proxy reconciled. The dashboard now answers on this domain.",
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
          The domain this dashboard itself is served on, where you and your team sign in.
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
