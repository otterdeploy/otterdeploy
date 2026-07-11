import { Field, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";

import type { ProvisionFormApi } from "./server-provision-form";

const MESH_ITEMS = [
  { label: "Public (routable IP)", value: "none" },
  { label: "Tailscale mesh", value: "tailscale" },
  { label: "NetBird mesh", value: "netbird" },
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
            <FieldLabel htmlFor="srv-mesh">Connectivity</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                if (v === "none" || v === "tailscale" || v === "netbird") field.handleChange(v);
              }}
              items={MESH_ITEMS}
            >
              <SelectTrigger id="srv-mesh" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MESH_ITEMS.map((it) => (
                  <SelectItem key={it.value} value={it.value}>
                    {it.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                Labelled for build workloads. Requires a registry so deploy nodes can pull the image.
              </span>
            </div>
            <Switch checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
          </div>
        )}
      </form.Field>

      <form.Field name="cloudflareToken">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="srv-cf">Cloudflare Tunnel token (optional)</FieldLabel>
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
