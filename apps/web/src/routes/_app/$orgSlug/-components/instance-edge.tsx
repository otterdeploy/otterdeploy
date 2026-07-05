/**
 * Edge defaults card — install-wide edge-proxy (Caddy) options: the ACME
 * registration email and the automatic HTTP→HTTPS redirect. Canonical home on
 * the Instance page (the copy under a project's Networking tab edits the same
 * platform_settings row). Saving reconciles the live edge; neither option can
 * produce invalid global syntax, so a value here can't take routes offline.
 */

import { useEffect, useState } from "react";
import { EarthIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsFooter, SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

export function EdgeDefaultsCard({ organizationId }: { organizationId: never }) {
  const query = useQuery(
    orpc.organization.getEdgeOptions.queryOptions({ input: { organizationId } }),
  );

  const [acmeEmail, setAcmeEmail] = useState("");
  const [httpsAutoRedirect, setHttpsAutoRedirect] = useState(true);

  // Hydrate once the saved options arrive.
  useEffect(() => {
    if (!query.data) return;
    setAcmeEmail(query.data.acmeEmail ?? "");
    setHttpsAutoRedirect(query.data.httpsAutoRedirect);
  }, [query.data]);

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

  const dirty =
    (query.data?.acmeEmail ?? "") !== acmeEmail ||
    (query.data?.httpsAutoRedirect ?? true) !== httpsAutoRedirect;

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
          <Input
            type="email"
            value={acmeEmail}
            onChange={(e) => setAcmeEmail(e.target.value)}
            placeholder="ops@example.com"
            className="font-mono text-[12.5px] sm:w-64"
            disabled={save.isPending || query.isLoading}
          />
        }
      />
      <SettingsRow
        title="Automatic HTTPS redirect"
        description="Redirect HTTP→HTTPS at the edge (Caddy default). Turn off if a downstream load balancer already terminates and redirects TLS."
        control={
          <Switch
            checked={httpsAutoRedirect}
            disabled={save.isPending || query.isLoading}
            onCheckedChange={setHttpsAutoRedirect}
          />
        }
      />
      <SettingsFooter>
        {dirty && <span className="text-[11.5px] text-muted-foreground">Unsaved changes</span>}
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              organizationId,
              acmeEmail: acmeEmail.trim() === "" ? null : acmeEmail.trim(),
              httpsAutoRedirect,
            })
          }
        >
          {save.isPending ? "Saving…" : "Save & apply"}
        </Button>
      </SettingsFooter>
    </SettingsSection>
  );
}
