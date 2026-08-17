import { useState } from "react";

import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Field, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Cloudflare } from "@/shared/components/ui/svgs/cloudflare";
import { NetBird } from "@/shared/components/ui/svgs/netbird";
import { Tailscale } from "@/shared/components/ui/svgs/tailscale";
import { Switch } from "@/shared/components/ui/switch";

import type { ProvisionFormApi } from "./server-provision-form";

import { PickerGroup, type PickerOption, PickerToggle } from "./provision-picker";

const MESH_ITEMS: PickerOption<string>[] = [
  {
    value: "none",
    label: "Public",
    hint: "Routable IP",
    icon: <HugeiconsIcon icon={Globe02Icon} strokeWidth={2} />,
  },
  { value: "tailscale", label: "Tailscale", hint: "WireGuard mesh", icon: <Tailscale /> },
  { value: "netbird", label: "NetBird", hint: "WireGuard mesh", icon: <NetBird /> },
];

/** Connectivity (mesh/tunnel) + build-node designation. Mesh joins the node to a
 *  WireGuard network and advertises the swarm on the mesh IP; Cloudflare Tunnel
 *  installs a connector for NAT/ingress. */
export function ProvisionAdvancedSection({ form }: { form: ProvisionFormApi }) {
  const { t } = useTranslation();
  // Local disclosure only: the field value stays the source of truth, so a
  // prefilled token (re-add of a failed server) opens the card on mount.
  const [cfOpen, setCfOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3">
      <form.Field name="meshProvider">
        {(field) => (
          <Field>
            <FieldLabel>{t("servers.advanced.connectivity")}</FieldLabel>
            <PickerGroup
              label={t("servers.advanced.connectivity")}
              columns={3}
              value={field.state.value}
              onChange={(v) => {
                if (v === "none" || v === "tailscale" || v === "netbird") field.handleChange(v);
              }}
              options={MESH_ITEMS}
            />
            <p className="text-[12px] text-muted-foreground">
              Mesh installs a WireGuard agent and joins the swarm over the private network. Use it
              when the manager has no routable public IP.
            </p>
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(s) => s.values.meshProvider}>
        {(mesh) =>
          mesh === "none" ? null : (
            <div className="flex flex-col gap-3">
              <form.Field
                name="meshAuthKey"
                validators={{
                  onChange: ({ value }) =>
                    value.trim().length === 0 ? "Auth key is required for a mesh join" : undefined,
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="srv-mesh-key">
                      {mesh === "tailscale" ? "Tailscale auth key" : "NetBird setup key"}
                    </FieldLabel>
                    <Input
                      id="srv-mesh-key"
                      type="password"
                      className="font-mono"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <p className="text-[12px] text-muted-foreground">
                      Used once to join the mesh, then discarded. Never stored.
                    </p>
                  </Field>
                )}
              </form.Field>
              {mesh === "netbird" ? (
                <form.Field name="meshManagementUrl">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="srv-nb-mgmt">Management URL (self-hosted)</FieldLabel>
                      <Input
                        id="srv-nb-mgmt"
                        placeholder="https://netbird.example.com"
                        className="font-mono"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
              ) : null}
            </div>
          )
        }
      </form.Subscribe>

      <form.Field name="buildServer">
        {(field) => (
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                {t("servers.advanced.buildNode")}
              </span>
              <span className="text-[12px] text-muted-foreground">
                Labelled for build workloads. Requires a registry so deploy nodes can pull the
                image.
              </span>
            </div>
            <Switch checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
          </div>
        )}
      </form.Field>

      <form.Field name="cloudflareToken">
        {(field) => (
          <PickerToggle
            label={t("servers.advanced.tunnel")}
            hint={t("servers.advanced.tunnelHint")}
            icon={<Cloudflare />}
            enabled={field.state.value.length > 0 || cfOpen}
            onToggle={(next) => {
              setCfOpen(next);
              // Clearing on collapse keeps the form honest: a hidden token would
              // still be submitted, so the closed card must mean "not using it".
              if (!next) field.handleChange("");
            }}
          >
            <Field>
              <FieldLabel htmlFor="srv-cf">{t("servers.advanced.tunnelToken")}</FieldLabel>
              <Input
                id="srv-cf"
                type="password"
                className="font-mono"
                placeholder={t("servers.advanced.tunnelPlaceholder")}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </Field>
          </PickerToggle>
        )}
      </form.Field>
    </section>
  );
}
