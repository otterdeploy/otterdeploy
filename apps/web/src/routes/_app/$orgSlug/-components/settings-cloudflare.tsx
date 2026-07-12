import { CloudIcon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/shared/components/ui/native-select";
import { orpc, queryClient } from "@/shared/server/orpc";

// Cloudflare API-token deep link. `permissionGroups` is the documented
// query param that pre-selects the scope on the create-token page; the
// user only has to pick the zone under "Zone Resources" and hit Create.
// We pass "Zone.DNS:Edit" — the minimum scope auto-configure DNS needs.
// (Cloudflare doesn't offer OAuth for DNS, so this is as close to
// one-click as their dashboard allows.)
const CLOUDFLARE_TOKEN_TEMPLATE_URL =
  "https://dash.cloudflare.com/profile/api-tokens?permissionGroups=Zone.DNS%3AEdit&name=otterdeploy";

function invalidateSettings(organizationId: never) {
  return queryClient.invalidateQueries({
    queryKey: orpc.organization.settings.queryKey({
      input: { organizationId },
    }),
  });
}

export function CloudflareCard({ organizationId }: { organizationId: never }) {
  const settingsQuery = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId } }),
  );
  const isConfigured = settingsQuery.data?.cloudflareTokenConfigured ?? false;
  const currentZoneId = settingsQuery.data?.cloudflareZoneId ?? null;

  return (
    <SettingsSection
      icon={CloudIcon}
      title="Cloudflare"
      description="Connect Cloudflare and we'll write the DNS records for you when you save a domain. Cloudflare doesn't support OAuth for DNS, so the one-click button opens Cloudflare with the right scopes (Zone.DNS:Edit) pre-selected — you click Create on their side and paste the token back here once."
    >
      <div className="p-4">
        {isConfigured ? (
          <CloudflareConnected organizationId={organizationId} zoneId={currentZoneId} />
        ) : (
          <CloudflareConnectForm organizationId={organizationId} />
        )}
      </div>
    </SettingsSection>
  );
}

function CloudflareConnected({
  organizationId,
  zoneId,
}: {
  organizationId: never;
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
  organizationId: never;
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
      <ol className="flex flex-col gap-3 text-[12.5px]">
        <li className="flex items-start gap-3">
          <StepNumber n={1} />
          <div className="flex flex-1 flex-col gap-2">
            <span>Open Cloudflare with the right scopes pre-filled.</span>
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  window.open(
                    CLOUDFLARE_TOKEN_TEMPLATE_URL,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                Open Cloudflare →
              </Button>
            </div>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <StepNumber n={2} />
          <div className="flex flex-1 flex-col gap-1.5">
            <span>
              On the Cloudflare page, pick the zone you want under "Zone
              Resources", then click <strong>Create Token</strong>. Copy the
              token Cloudflare shows you.
            </span>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <StepNumber n={3} />
          <div className="flex flex-1 flex-col gap-2">
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
          </div>
        </li>
      </ol>
      {zones && zones.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cf-zone" className="text-[12px] font-medium">
            Zone
          </label>
          <form.Field name="zoneId">
            {(field) => (
              <NativeSelect
                id="cf-zone"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                disabled={saveConfig.isPending}
              >
                <NativeSelectOption value="" disabled>
                  Select a zone…
                </NativeSelectOption>
                {zones.map((z) => (
                  <NativeSelectOption key={z.id} value={z.id}>
                    {z.name} ({z.status})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </form.Field>
        </div>
      )}
      {zones && zones.length === 0 && (
        <div className="text-[11.5px] text-muted-foreground">
          Token is valid but doesn't have access to any zones. Check that the
          token's scope includes the zone you want.
        </div>
      )}
      <div className="flex items-center justify-end">
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
      </div>
    </>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 font-mono text-[11px] font-semibold text-muted-foreground">
      {n}
    </span>
  );
}
