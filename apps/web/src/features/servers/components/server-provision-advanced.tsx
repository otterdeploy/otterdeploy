import { Globe02Icon, ShareKnowledgeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Field, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Cloudflare } from "@/shared/components/ui/svgs/cloudflare";
import { Tailscale } from "@/shared/components/ui/svgs/tailscale";
import { Switch } from "@/shared/components/ui/switch";

import type { ProvisionFormApi } from "./server-provision-form";

import { PickerGroup, type PickerOption } from "./provision-picker";

// Tailscale is the Simple Icons mark; NetBird publishes no mark to Simple Icons
// and none was reachable from its own repos, so it carries a neutral network
// glyph rather than an invented logo — swap in the real asset when you have it.
const MESH_ITEMS: PickerOption<string>[] = [
  {
    value: "none",
    label: "Public",
    hint: "Routable IP",
    icon: <HugeiconsIcon icon={Globe02Icon} strokeWidth={2} className="size-4" />,
  },
  {
    value: "tailscale",
    label: "Tailscale",
    hint: "WireGuard mesh",
    icon: <Tailscale className="size-4" />,
  },
  {
    value: "netbird",
    label: "NetBird",
    hint: "WireGuard mesh",
    icon: <HugeiconsIcon icon={ShareKnowledgeIcon} strokeWidth={2} className="size-4" />,
  },
];

/** Connectivity (mesh/tunnel) + build-node designation. Mesh joins the node to a
 *  WireGuard network and advertises the swarm on the mesh IP; Cloudflare Tunnel
 *  installs a connector for NAT/ingress. */
export function ProvisionAdvancedSection({ form }: { form: ProvisionFormApi }) {
  return (
    <section className="flex flex-col gap-3">
      <form.Field name="meshProvider">
        {(field) => (
          <Field>
            <FieldLabel>Connectivity</FieldLabel>
            <PickerGroup
              label="Connectivity"
              columns={3}
              value={field.state.value}
              onChange={(v) => {
                if (v === "none" || v === "tailscale" || v === "netbird") field.handleChange(v);
              }}
              options={MESH_ITEMS}
            />
            <p className="text-[12px] text-muted-foreground">
              Mesh installs a WireGuard agent and joins the swarm over the private network — the
              robust path when the manager has no routable public IP.
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
                      Used once to join the mesh, then discarded — never stored.
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
              <span className="text-sm font-medium text-foreground">Dedicated build node</span>
              <span className="text-[12px] text-muted-foreground">
                Labelled for build workloads. Requires a registry so deploy nodes can pull the
                image.
              </span>
            </div>
            <Switch checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
          </div>
        )}
      </form.Field>

      {/* Orthogonal to the mesh choice above — a tunnel is for ingress, not for
          the swarm join — so it stays its own opt-in rather than a fourth
          connectivity card that would imply they're alternatives. */}
      <form.Field name="cloudflareToken">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="srv-cf">
              <span className="flex items-center gap-2">
                <Cloudflare className="size-4 text-muted-foreground" />
                Cloudflare Tunnel token (optional)
              </span>
            </FieldLabel>
            <Input
              id="srv-cf"
              type="password"
              className="font-mono"
              placeholder="installs cloudflared on the node"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </Field>
        )}
      </form.Field>
    </section>
  );
}
