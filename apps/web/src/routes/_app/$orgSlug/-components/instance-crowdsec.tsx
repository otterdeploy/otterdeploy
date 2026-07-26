/**
 * CrowdSec card — the bouncer credentials that wire the IP-reputation gate into
 * the generated Caddyfile. Saving re-renders the edge immediately.
 *
 * Deliberately honest about its limit: the control plane can write the config
 * and reconcile Caddy, but it cannot start the CrowdSec agent container — that
 * is `docker compose --profile firewall up -d` on the host. So this card
 * reports whether the gate is configured, and the Firewall page reports whether
 * the agent is actually answering. Claiming a single "enabled" state would be
 * lying about one of the two.
 */

import { useState } from "react";

import type { OrganizationId } from "@otterdeploy/shared/id";
import { ShieldIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsFooter, SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

import { SecretRow } from "./instance-secret-row";

export function CrowdsecCard({ organizationId }: { organizationId: OrganizationId }) {
  const query = useQuery(
    orpc.organization.getCrowdsecSettings.queryOptions({ input: { organizationId } }),
  );

  const [lapiUrl, setLapiUrl] = useState<string | null>(null);
  const [bouncerKey, setBouncerKey] = useState("");

  const save = useMutation({
    ...orpc.organization.setCrowdsecSettings.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.organization.getCrowdsecSettings.queryKey({ input: { organizationId } }),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.firewall.status.queryKey() }),
      ]);
      setLapiUrl(null);
      setBouncerKey("");
      toast.success("CrowdSec settings saved", { description: "Edge proxy reconciled." });
    },
    onError: (err) => toast.error(err.message ?? "Failed to save CrowdSec settings"),
  });

  // Normalize once so the JSX reads plain fields. `enabled` defaults to true:
  // a never-touched install with env credentials was already enforcing.
  const raw = query.data;
  const data = {
    enabled: raw?.enabled ?? true,
    lapiUrl: raw?.lapiUrl ?? "",
    bouncerKeyConfigured: raw?.bouncerKeyConfigured ?? false,
    envConfigured: raw?.envConfigured ?? false,
    effective: raw?.effective ?? false,
  };
  const urlValue = lapiUrl ?? data.lapiUrl;
  const enabled = data.enabled;
  const busy = save.isPending || query.isLoading;
  const dirty = lapiUrl !== null || bouncerKey.length > 0;

  const submit = (nextEnabled: boolean) =>
    save.mutate({
      organizationId,
      enabled: nextEnabled,
      lapiUrl: urlValue.trim() || null,
      ...(bouncerKey ? { bouncerKey } : {}),
    });

  return (
    <SettingsSection
      icon={ShieldIcon}
      title="CrowdSec"
      description="IP-reputation enforcement at the edge. Saving re-renders the Caddyfile — the agent container itself is started by the compose firewall profile on the host."
    >
      <SettingsRow
        title="Edge enforcement"
        description={
          data.effective
            ? "On — the crowdsec gate is rendered into every site block."
            : enabled
              ? "Credentials incomplete, so no gate is rendered. Add the LAPI URL and bouncer key below."
              : "Off — credentials are kept, but no gate is rendered."
        }
        control={
          <div className="flex items-center gap-2.5">
            {data.envConfigured && !data.bouncerKeyConfigured && (
              <Badge variant="outline" className="font-mono text-[10px]">
                From env
              </Badge>
            )}
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={(checked) => submit(checked)}
            />
          </div>
        }
      />
      <SettingsRow
        title="LAPI URL"
        description="The agent's address on the install network — http://crowdsec:8080 for the bundled compose service."
        control={
          <Input
            value={urlValue}
            onChange={(e) => setLapiUrl(e.target.value)}
            placeholder="http://crowdsec:8080"
            className="font-mono text-[12.5px] sm:w-72"
            disabled={busy}
          />
        }
      />
      <SecretRow
        title="Bouncer key"
        configured={data.bouncerKeyConfigured}
        fromEnv={data.envConfigured}
        unsetDescription="The API key the Caddy bouncer authenticates with. Encrypted at rest."
        value={bouncerKey}
        onChange={setBouncerKey}
        disabled={busy}
      />
      <SettingsFooter>
        {dirty && <span className="text-[11.5px] text-muted-foreground">Unsaved changes</span>}
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => submit(enabled)}>
          {save.isPending ? "Saving…" : "Save & apply"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
