import type { OrganizationId } from "@otterdeploy/shared/id";
import { CloudIcon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsFooter, SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

import { STEP, StepNumber, TokenSetupSteps, ZonePicker } from "./settings-cloudflare-steps";

function invalidateSettings(organizationId: OrganizationId) {
  return queryClient.invalidateQueries({
    queryKey: orpc.organization.settings.queryKey({
      input: { organizationId },
    }),
  });
}

export function CloudflareCard({ organizationId }: { organizationId: OrganizationId }) {
  const settingsQuery = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId } }),
  );
  const isConfigured = settingsQuery.data?.cloudflareTokenConfigured ?? false;
  const currentZoneId = settingsQuery.data?.cloudflareZoneId ?? null;

  return (
    // One sentence in the header: what connecting BUYS you. The mechanics
    // (why a pasted token and not OAuth, which scope) belong to the step that
    // needs them, not to a paragraph you must read before the first step.
    <SettingsSection
      icon={CloudIcon}
      title="Cloudflare"
      description="Connect Cloudflare and we'll write the DNS records for you whenever you save a domain."
    >
      {isConfigured ? (
        <div className="p-5">
          <CloudflareConnected organizationId={organizationId} zoneId={currentZoneId} />
        </div>
      ) : (
        // Renders its own padded body + footer as siblings so the card's
        // `divide-y` puts a hairline between the steps and the action.
        <CloudflareConnectForm organizationId={organizationId} />
      )}
    </SettingsSection>
  );
}

function CloudflareConnected({
  organizationId,
  zoneId,
}: {
  organizationId: OrganizationId;
  zoneId: string | null;
}) {
  const disconnect = useMutation({
    ...orpc.organization.setCloudflareConfig.mutationOptions(),
    onSuccess: async () => {
      await invalidateSettings(organizationId);
      toast.success("Cloudflare disconnected");
    },
    onError: (err) => toast.error(err.message ?? "Disconnect failed"),
  });
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-[13px] font-medium">Connected</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          Zone {zoneId ?? "(none)"}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disconnect.isPending}
        onClick={() =>
          disconnect.mutate({ organizationId, token: "", zoneId: null })
        }
      >
        {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
      </Button>
    </div>
  );
}

function CloudflareConnectForm({
  organizationId,
}: {
  organizationId: OrganizationId;
}) {
  const zonesQuery = useMutation({
    ...orpc.organization.cloudflareListZones.mutationOptions(),
    onError: (err) => toast.error(err.message ?? "Couldn't list zones"),
  });
  const saveConfig = useMutation({
    ...orpc.organization.setCloudflareConfig.mutationOptions(),
    onSuccess: async () => {
      await invalidateSettings(organizationId);
      form.reset();
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
                            // zone — the common case. Saves a dropdown click.
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
