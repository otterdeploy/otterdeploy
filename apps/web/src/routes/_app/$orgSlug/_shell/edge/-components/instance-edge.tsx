/**
 * Edge defaults card: install-wide edge-proxy (Caddy) options — the ACME
 * registration email, the automatic HTTP→HTTPS redirect, and the list of
 * proxies in front of Caddy. Canonical home on the Instance page (the copy
 * under a project's Networking tab edits the same platform_settings row, and
 * leaves the proxy list alone since it doesn't offer it). Saving reconciles
 * the live edge; none of these can produce invalid global syntax, so a value
 * here can't take routes offline.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";
import { EarthIcon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsFooter, SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { orpc, queryClient } from "@/shared/server/orpc";

/** Cloudflare's published egress ranges. Offered as a one-click fill because
 *  typing twenty-two CIDRs by hand is how this field gets left empty — and an
 *  empty field is exactly the state that makes the Firewall ban the CDN. */
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
].join("\n");

export function EdgeDefaultsCard({ organizationId }: { organizationId: OrganizationId }) {
  const query = useQuery(
    orpc.organization.getEdgeOptions.queryOptions({ input: { organizationId } }),
  );

  const save = useMutation({
    ...orpc.organization.setEdgeOptions.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.getEdgeOptions.queryKey({ input: { organizationId } }),
      });
      toast.success("Edge defaults saved", { description: "Edge proxy reconciled." });
    },
    onError: (err) => toast.error(err.message ?? "Failed to save edge defaults"),
  });

  // Server-seeded defaults: hydrate the fields until the user touches them,
  // then background refetches stop overwriting the draft.
  const form = useForm({
    defaultValues: {
      acmeEmail: query.data?.acmeEmail ?? "",
      httpsAutoRedirect: query.data?.httpsAutoRedirect ?? true,
      trustedProxies: query.data?.trustedProxies ?? "",
    },
    onSubmit: ({ value }) => {
      save.mutate({
        organizationId,
        acmeEmail: value.acmeEmail.trim() === "" ? null : value.acmeEmail.trim(),
        httpsAutoRedirect: value.httpsAutoRedirect,
        trustedProxies: value.trustedProxies.trim(),
      });
    },
  });

  return (
    <SettingsSection
      icon={EarthIcon}
      title="Edge defaults"
      description="Install-wide edge-proxy settings. Changes apply to every project and reconcile the edge immediately."
    >
      <SettingsRow
        title="ACME email"
        description="Registered with Let's Encrypt for cert notices + recovery. Required before any public (non-sslip) domain gets a real certificate."
        control={
          <form.Field name="acmeEmail">
            {(field) => (
              <Input
                type="email"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="ops@example.com"
                className="font-mono text-[12.5px] sm:w-64"
                disabled={save.isPending || query.isLoading}
              />
            )}
          </form.Field>
        }
      />
      <SettingsRow
        title="Automatic HTTPS redirect"
        description="Redirect HTTP→HTTPS at the edge (Caddy default). Turn off if a downstream load balancer already terminates and redirects TLS."
        control={
          <form.Field name="httpsAutoRedirect">
            {(field) => (
              <Switch
                checked={field.state.value}
                disabled={save.isPending || query.isLoading}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
            )}
          </form.Field>
        }
      />
      <SettingsRow
        title="Trusted proxies"
        description="CIDRs of anything in front of Caddy — a CDN, an upstream load balancer. Until these are listed, Caddy attributes every request to the hop it can see, so access logs, geo and the Firewall's flagged IPs all record the proxy instead of the visitor, and blocking one bans everyone behind it."
        control={
          <form.Field name="trustedProxies">
            {(field) => (
              <div className="flex flex-col items-end gap-1.5">
                <Textarea
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={"203.0.113.0/24\n2001:db8::/32"}
                  rows={4}
                  spellCheck={false}
                  className="font-mono text-[12.5px] sm:w-64"
                  disabled={save.isPending || query.isLoading}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={save.isPending || query.isLoading}
                  onClick={() => field.handleChange(CLOUDFLARE_RANGES)}
                >
                  Fill Cloudflare ranges
                </Button>
              </div>
            )}
          </form.Field>
        }
      />
      <SettingsFooter>
        <form.Subscribe selector={(s) => s.values}>
          {(values) => {
            const dirty =
              (query.data?.acmeEmail ?? "") !== values.acmeEmail ||
              (query.data?.httpsAutoRedirect ?? true) !== values.httpsAutoRedirect ||
              (query.data?.trustedProxies ?? "") !== values.trustedProxies;
            return (
              <>
                {dirty && (
                  <span className="text-[11.5px] text-muted-foreground">Unsaved changes</span>
                )}
                <Button
                  size="sm"
                  disabled={!dirty || save.isPending}
                  onClick={() => void form.handleSubmit()}
                >
                  {save.isPending ? "Saving…" : "Save & apply"}
                </Button>
              </>
            );
          }}
        </form.Subscribe>
      </SettingsFooter>
    </SettingsSection>
  );
}
