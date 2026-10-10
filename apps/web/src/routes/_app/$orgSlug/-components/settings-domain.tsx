import type { OrganizationId } from "@otterdeploy/shared/id";
import { EarthIcon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";

import { BaseDomainRecords } from "@/features/domains/components/base-domain-records";
import { ChangeDomainDialog } from "@/features/domains/components/change-domain-dialog";
import { PublishAtRow } from "@/features/domains/components/publish-at-row";
import {
  invalidateBaseDomain,
  useBaseDomainDns,
  useBaseDomainHostnames,
} from "@/features/domains/data/use-base-domain";
import { useCanManageWorkspace } from "@/features/team/data/use-team";
import { SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

type DomainStatus = "unset" | "pending" | "verified";

function domainStatus(current: string, verifiedAt: unknown): DomainStatus {
  if (!current) return "unset";
  return verifiedAt ? "verified" : "pending";
}

export function DomainCard({ organizationId }: { organizationId: OrganizationId }) {
  const settingsQuery = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId } }),
  );
  const [confirming, setConfirming] = useState(false);

  const current = settingsQuery.data?.baseDomain ?? "";

  const setBaseDomain = useMutation({
    ...orpc.organization.setBaseDomain.mutationOptions(),
    onSuccess: async (_, input) => {
      setConfirming(false);
      await invalidateBaseDomain(organizationId);
      toast.success(
        !input.baseDomain ? "Domain removed" : current ? "Domain changed" : "Domain saved",
      );
    },
    onError: (err) => toast.error(err.message ?? "Failed to save domain"),
  });

  // Server-seeded default: hydrates the field until the user touches it.
  const form = useForm({
    defaultValues: { baseDomain: current },
    onSubmit: ({ value }) =>
      setBaseDomain.mutate({ organizationId, baseDomain: value.baseDomain.trim() }),
  });

  const verifiedAt = settingsQuery.data?.baseDomainVerifiedAt ?? null;
  const status = domainStatus(current, verifiedAt);

  // Every mutation here (save, verify, auto-configure) is
  // `organization:update`. Members may read the domain and its status; the
  // controls that would only 403 are omitted rather than offered.
  const { user } = useRouteContext({ from: "/_app" });
  const canManage = useCanManageWorkspace(organizationId, user.id);

  return (
    <SettingsSection
      icon={EarthIcon}
      title="Base domain"
      description={
        <>
          Every service you expose gets a hostname under this domain: service web in project shop
          becomes <span className="whitespace-nowrap">web-shop.acme.com</span>. Without one, services use a temporary address on this
          server&apos;s IP. A project or a service can set its own domain instead.
        </>
      }
    >
      <form.Subscribe selector={(s) => s.values.baseDomain}>
        {(typed) => {
          const dirty = typed.trim().toLowerCase() !== current.toLowerCase();
          // Changing a domain that is already set goes through a dialog: it is
          // the one save here with consequences the field can't show.
          const changing = dirty && current.length > 0;
          return (
            <>
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
                        aria-label="Base domain"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={!canManage || setBaseDomain.isPending || settingsQuery.isLoading}
                        readOnly={!canManage}
                        className="font-mono text-[13px]"
                      />
                    )}
                  </form.Field>
                  {canManage && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={!dirty || setBaseDomain.isPending}
                      onClick={() => (changing ? setConfirming(true) : void form.handleSubmit())}
                    >
                      {setBaseDomain.isPending ? "Saving…" : changing ? "Change domain" : "Save"}
                    </Button>
                  )}
                </div>
                {!canManage && (
                  <p className="text-[12px] text-muted-foreground">
                    Only workspace owners and admins can change the domain.
                  </p>
                )}
              </div>

              <DomainCardDetails
                organizationId={organizationId}
                current={current}
                typed={typed}
                dirty={dirty}
                canManage={canManage}
                cloudflareConnected={settingsQuery.data?.cloudflareTokenConfigured ?? false}
                confirming={confirming}
                onConfirmingChange={setConfirming}
                saving={setBaseDomain.isPending}
                onConfirm={() => void form.handleSubmit()}
              />
            </>
          );
        }}
      </form.Subscribe>
    </SettingsSection>
  );
}

/** Everything under the field: what new services publish at, the records
 *  with their live status, and the change dialog. */
function DomainCardDetails({
  organizationId,
  current,
  typed,
  dirty,
  canManage,
  cloudflareConnected,
  confirming,
  onConfirmingChange,
  saving,
  onConfirm,
}: {
  organizationId: OrganizationId;
  current: string;
  typed: string;
  dirty: boolean;
  canManage: boolean;
  cloudflareConnected: boolean;
  confirming: boolean;
  onConfirmingChange: (open: boolean) => void;
  saving: boolean;
  onConfirm: () => void;
}) {
  const dnsQuery = useBaseDomainDns(organizationId);
  const hostnamesQuery = useBaseDomainHostnames(organizationId, confirming);
  const dns = dnsQuery.data;
  return (
    <>
      <PublishAtRow dns={dns} typed={typed} dirty={dirty} loading={dnsQuery.isLoading} />

      {current ? (
        <BaseDomainRecords
          organizationId={organizationId}
          baseDomain={current}
          dns={dns}
          checking={dnsQuery.isFetching}
          canManage={canManage}
          cloudflareConnected={cloudflareConnected}
        />
      ) : null}

      <ChangeDomainDialog
        open={confirming}
        onOpenChange={onConfirmingChange}
        current={current}
        next={typed.trim().toLowerCase()}
        impact={hostnamesQuery.data}
        loading={hostnamesQuery.isLoading}
        saving={saving}
        onConfirm={onConfirm}
      />
    </>
  );
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
