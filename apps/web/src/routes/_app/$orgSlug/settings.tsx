/**
 * Organization settings — domain section + (future) Cloudflare hookup.
 *
 * Phase 1 only saves the org's base domain. The "Verify" surface and the
 * Cloudflare auto-configure button arrive in Phase 2 / 3 — the layout
 * leaves space for them so this doesn't churn when they land.
 */

import { useState } from "react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/shared/components/ui/native-select";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/settings")({
  staticData: { crumb: "Settings" },
  component: SettingsRoute,
});

// Cloudflare API-token deep link. `permissionGroups` is the documented
// query param that pre-selects the scope on the create-token page; the
// user only has to pick the zone under "Zone Resources" and hit Create.
// We pass "Zone.DNS:Edit" — the minimum scope auto-configure DNS needs.
// (Cloudflare doesn't offer OAuth for DNS, so this is as close to
// one-click as their dashboard allows.)
const CLOUDFLARE_TOKEN_TEMPLATE_URL =
  "https://dash.cloudflare.com/profile/api-tokens?permissionGroups=Zone.DNS%3AEdit&name=otterdeploy";

function SettingsRoute() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  return (
    <Page width="narrow">
      <PageHeader
        title="Settings"
        description={
          <>
            Workspace-wide configuration for{" "}
            <span className="font-medium text-foreground">
              {organization.name}
            </span>
            .
          </>
        }
      />

      <DomainCard organizationId={organization.id as never} />
      <CloudflareCard organizationId={organization.id as never} />
    </Page>
  );
}

function DomainCard({ organizationId }: { organizationId: never }) {
  const settingsQuery = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId } }),
  );
  const invalidateSettings = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.organization.settings.queryKey({
        input: { organizationId },
      }),
    });
  const setBaseDomain = useMutation({
    ...orpc.organization.setBaseDomain.mutationOptions(),
    onSuccess: async () => {
      await invalidateSettings();
      toast.success("Domain saved");
    },
    onError: (err) => toast.error(err.message ?? "Failed to save domain"),
  });
  const verifyBaseDomain = useMutation({
    ...orpc.organization.verifyBaseDomain.mutationOptions(),
    onSuccess: async (result) => {
      await invalidateSettings();
      if (result.ok) {
        toast.success("Domain verified");
      } else {
        toast.error(verifyReasonMessage(result));
      }
    },
    onError: (err) => toast.error(err.message ?? "Verification failed"),
  });

  const [value, setValue] = useState<string | null>(null);
  const current = settingsQuery.data?.baseDomain ?? "";
  const displayed = value ?? current;
  const dirty = displayed.trim().toLowerCase() !== current.toLowerCase();

  const verifiedAt = settingsQuery.data?.baseDomainVerifiedAt ?? null;
  const verifyToken = settingsQuery.data?.baseDomainVerifyToken ?? null;
  const status: "unset" | "pending" | "verified" =
    !current ? "unset" : verifiedAt ? "verified" : "pending";

  return (
    <section className="flex flex-col gap-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Domain
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground/80">
          The apex domain your resources are published under. A service{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            web
          </code>{" "}
          in project{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            myproj
          </code>{" "}
          lands at{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
            web-myproj.apps.&lt;baseDomain&gt;
          </code>
          . Leave blank to use the platform default (sslip.io fallback when
          no domain is set).
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium">Base domain</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="acme.com"
            value={displayed}
            onChange={(e) => setValue(e.target.value)}
            disabled={setBaseDomain.isPending || settingsQuery.isLoading}
            className="font-mono text-[13px]"
          />
          <Button
            type="button"
            size="sm"
            disabled={!dirty || setBaseDomain.isPending}
            onClick={() =>
              setBaseDomain.mutate({
                organizationId,
                baseDomain: displayed.trim(),
              })
            }
          >
            {setBaseDomain.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        {status === "pending" && verifyToken && (
          <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 text-[11.5px] text-warning">
            <div className="font-medium">Pending verification</div>
            <div className="text-warning/85">
              Add a TXT record to your DNS so we can prove you own this
              domain. Once the record propagates, hit Verify.
            </div>
            <pre className="overflow-x-auto rounded bg-warning/10 px-2 py-1.5 font-mono text-[11px] text-warning/90">
              {`Name:  _otterdeploy-verify.${current}\nType:  TXT\nValue: ${verifyToken}`}
            </pre>
            <div className="flex items-center justify-end gap-2">
              {settingsQuery.data?.cloudflareTokenConfigured && (
                <CloudflareAutoConfigureButton organizationId={organizationId} />
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={verifyBaseDomain.isPending}
                onClick={() =>
                  verifyBaseDomain.mutate({ organizationId })
                }
              >
                {verifyBaseDomain.isPending ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function CloudflareAutoConfigureButton({
  organizationId,
}: {
  organizationId: never;
}) {
  const auto = useMutation({
    ...orpc.organization.autoConfigureBaseDomain.mutationOptions(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.settings.queryKey({
          input: { organizationId },
        }),
      });
      if (result.ok) {
        toast.success("DNS configured and domain verified");
      } else if (result.verify.reason === "no-record") {
        toast.message(
          "Records created. DNS is still propagating — try Verify in a moment.",
        );
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

function CloudflareCard({ organizationId }: { organizationId: never }) {
  const settingsQuery = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId } }),
  );
  const [token, setToken] = useState("");
  const [zoneId, setZoneId] = useState("");
  const isConfigured = settingsQuery.data?.cloudflareTokenConfigured ?? false;
  const currentZoneId = settingsQuery.data?.cloudflareZoneId ?? null;

  const zonesQuery = useMutation({
    ...orpc.organization.cloudflareListZones.mutationOptions(),
    onError: (err) => toast.error(err.message ?? "Couldn't list zones"),
  });
  const saveConfig = useMutation({
    ...orpc.organization.setCloudflareConfig.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.settings.queryKey({
          input: { organizationId },
        }),
      });
      setToken("");
      setZoneId("");
      toast.success("Cloudflare connected");
    },
    onError: (err) => toast.error(err.message ?? "Save failed"),
  });
  const disconnect = useMutation({
    ...orpc.organization.setCloudflareConfig.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.settings.queryKey({
          input: { organizationId },
        }),
      });
      toast.success("Cloudflare disconnected");
    },
    onError: (err) => toast.error(err.message ?? "Disconnect failed"),
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Cloudflare
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground/80">
          Connect Cloudflare and we'll write the DNS records for you when
          you save a domain. Cloudflare doesn't support OAuth for DNS, so
          the one-click button opens Cloudflare with the right scopes
          (Zone.DNS:Edit) pre-selected — you click Create on their side
          and paste the token back here once.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        {isConfigured ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[13px] font-medium">Connected</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                Zone {currentZoneId ?? "(none)"}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disconnect.isPending}
              onClick={() =>
                disconnect.mutate({
                  organizationId,
                  token: "",
                  zoneId: null,
                })
              }
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        ) : (
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
                    On the Cloudflare page, pick the zone you want under
                    "Zone Resources", then click <strong>Create Token</strong>
                    . Copy the token Cloudflare shows you.
                  </span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <StepNumber n={3} />
                <div className="flex flex-1 flex-col gap-2">
                  <span>Paste the token here.</span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      placeholder="cf_…"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      disabled={zonesQuery.isPending || saveConfig.isPending}
                      className="font-mono text-[13px]"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!token || zonesQuery.isPending}
                      onClick={() =>
                        zonesQuery.mutate(
                          { token },
                          {
                            onSuccess: (zones) => {
                              // Auto-select when the token is scoped to a
                              // single zone — the common case. Saves a
                              // dropdown click.
                              if (zones.length === 1) {
                                setZoneId(zones[0]!.id);
                              }
                            },
                          },
                        )
                      }
                    >
                      {zonesQuery.isPending ? "Loading…" : "Load zones"}
                    </Button>
                  </div>
                </div>
              </li>
            </ol>
            {zonesQuery.data && zonesQuery.data.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium">Zone</label>
                <NativeSelect
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                  disabled={saveConfig.isPending}
                >
                  <NativeSelectOption value="" disabled>
                    Select a zone…
                  </NativeSelectOption>
                  {zonesQuery.data.map((z) => (
                    <NativeSelectOption key={z.id} value={z.id}>
                      {z.name} ({z.status})
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            )}
            {zonesQuery.data && zonesQuery.data.length === 0 && (
              <div className="text-[11.5px] text-muted-foreground">
                Token is valid but doesn't have access to any zones. Check
                that the token's scope includes the zone you want.
              </div>
            )}
            <div className="flex items-center justify-end">
              <Button
                type="button"
                size="sm"
                disabled={!token || !zoneId || saveConfig.isPending}
                onClick={() =>
                  saveConfig.mutate({ organizationId, token, zoneId })
                }
              >
                {saveConfig.isPending ? "Saving…" : "Connect"}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 font-mono text-[11px] font-semibold text-muted-foreground">
      {n}
    </span>
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

function StatusBadge({
  status,
}: {
  status: "unset" | "pending" | "verified";
}) {
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
