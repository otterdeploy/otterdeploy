import type { OrganizationId } from "@otterdeploy/shared/id";
import { CloudIcon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";

import { CloudflareConnected } from "@/features/domains/components/cloudflare-connected";
import { invalidateBaseDomain, useCloudflareZone } from "@/features/domains/data/use-base-domain";
import { useCanManageWorkspace } from "@/features/team/data/use-team";
import { SettingsFooter, SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

import { STEP, StepNumber, TokenSetupSteps, ZonePicker } from "./settings-cloudflare-steps";

/** Folded to one row: Cloudflare is one way to write the base domain's
 *  records, not a setup step of its own. The three-step connect flow opens in
 *  place when asked for. */
export function CloudflareCard({ organizationId }: { organizationId: OrganizationId }) {
  const settingsQuery = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId } }),
  );
  const isConfigured = settingsQuery.data?.cloudflareTokenConfigured ?? false;
  const hasBaseDomain = Boolean(settingsQuery.data?.baseDomain);
  const zoneQuery = useCloudflareZone(organizationId, isConfigured);
  const [connecting, setConnecting] = useState(false);

  // `setCloudflareConfig` is `organization:update`. Owner/admin only. Reading
  // the settings is not, so a member may SEE whether Cloudflare is wired up;
  // they just can't change it. Without this they got the whole three-step
  // connect flow and a raw "The actor does not have the required permission."
  // at the end of it, having already pasted a live API token.
  const { user } = useRouteContext({ from: "/_app" });
  const canManage = useCanManageWorkspace(organizationId, user.id);

  return (
    <SettingsSection
      icon={CloudIcon}
      title="Cloudflare"
      badge={
        <span className="rounded-sm bg-muted px-1.5 py-px text-[10.5px] font-medium text-muted-foreground ring-1 ring-foreground/10">
          Optional
        </span>
      }
      description="If your domain's DNS is on Cloudflare, connect it and we'll write the records above for you. Any other provider works too: add them by hand."
    >
      {isConfigured ? (
        <CloudflareConnected
          organizationId={organizationId}
          zone={zoneQuery.data}
          zoneId={settingsQuery.data?.cloudflareZoneId ?? null}
          checking={zoneQuery.isLoading}
          canManage={canManage}
          canWrite={hasBaseDomain}
          replacing={connecting}
          onReplace={() => setConnecting((v) => !v)}
        />
      ) : (
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] font-medium">Not connected</span>
            <span className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
              {canManage
                ? "Takes about a minute. You'll create a token with DNS edit access on Cloudflare and paste it here."
                : "Only workspace owners and admins can connect Cloudflare."}
            </span>
          </div>
          {canManage && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-expanded={connecting}
              onClick={() => setConnecting((v) => !v)}
            >
              {connecting ? "Cancel" : "Connect Cloudflare"}
            </Button>
          )}
        </div>
      )}
      {canManage && connecting ? (
        // Renders its own padded body + footer as siblings so the card's
        // `divide-y` puts a hairline between the steps and the action.
        <CloudflareConnectForm
          organizationId={organizationId}
          onConnected={() => setConnecting(false)}
        />
      ) : null}
    </SettingsSection>
  );
}

function CloudflareConnectForm({
  organizationId,
  onConnected,
}: {
  organizationId: OrganizationId;
  onConnected: () => void;
}) {
  const zonesQuery = useMutation({
    ...orpc.organization.cloudflareListZones.mutationOptions(),
    onError: (err) => toast.error(err.message ?? "Couldn't list zones"),
  });
  const saveConfig = useMutation({
    ...orpc.organization.setCloudflareConfig.mutationOptions(),
    onSuccess: async () => {
      await invalidateBaseDomain(organizationId);
      form.reset();
      onConnected();
      toast.success("Cloudflare connected");
    },
    onError: (err) => toast.error(err.message ?? "Save failed"),
  });

  const form = useForm({
    defaultValues: { token: "", zoneId: "" },
    onSubmit: ({ value }) =>
      saveConfig.mutate({ organizationId, token: value.token, zoneId: value.zoneId }),
  });

  const zones = zonesQuery.data;

  return (
    <>
      {/* gap-6 between steps, not gap-3: at 12.5px/gap-3 the three steps read
          as one paragraph with numbers in it. One step, one beat. */}
      <ol className="flex flex-col gap-6 p-5 text-[13px] leading-relaxed">
        <TokenSetupSteps />
        <li className={STEP}>
          <StepNumber n={3} />
          <div className="flex flex-1 flex-col gap-3">
            <span>Paste the token here.</span>
            <div className="flex items-center gap-2">
              <form.Field name="token">
                {(field) => (
                  <Input
                    type="password"
                    placeholder="cf_…"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={zonesQuery.isPending || saveConfig.isPending}
                    className="font-mono text-[13px]"
                  />
                )}
              </form.Field>
              <form.Subscribe selector={(s) => s.values.token}>
                {(token) => (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!token || zonesQuery.isPending}
                    onClick={() =>
                      zonesQuery.mutate(
                        { token },
                        {
                          onSuccess: (result) => {
                            // Auto-select when the token is scoped to a single
                            // zone: the common case. Saves a dropdown click.
                            const only =
                              result.length === 1 ? result[0] : undefined;
                            if (only) form.setFieldValue("zoneId", only.id);
                          },
                        },
                      )
                    }
                  >
                    {zonesQuery.isPending ? "Loading…" : "Load zones"}
                  </Button>
                )}
              </form.Subscribe>
            </div>
            {/* The zone picker is the tail of step 3, not a fourth step: it
                appears only once the token has resolved, and it belongs to the
                token that produced it. */}
            <form.Field name="zoneId">
              {(field) => (
                <ZonePicker
                  zones={zones}
                  value={field.state.value}
                  onChange={(id) => field.handleChange(id)}
                  saving={saveConfig.isPending}
                />
              )}
            </form.Field>
          </div>
        </li>
      </ol>
      {/* Its own bar, hairline-divided by the card: the primary action was
          sitting flush under the token row, reading as part of step 3. */}
      <SettingsFooter>
        <form.Subscribe selector={(s) => s.values}>
          {({ token, zoneId }) => (
            <Button
              type="button"
              size="sm"
              disabled={!token || !zoneId || saveConfig.isPending}
              onClick={() => void form.handleSubmit()}
            >
              {saveConfig.isPending ? "Saving…" : "Connect"}
            </Button>
          )}
        </form.Subscribe>
      </SettingsFooter>
    </>
  );
}
