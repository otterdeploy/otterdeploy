/**
 * Editor for instance-wide edge-proxy (Caddy) global options — the ACME
 * registration email and the automatic HTTP→HTTPS redirect. Stored on the
 * platform_settings singleton; saving reconciles the edge. Neither option can
 * produce invalid global syntax, and reconcile only swaps the live config in
 * after a successful adapt, so a value here can't take routes offline.
 *
 * Scoped under a project's Networking page for discoverability, but the values
 * are install-wide; editing is gated server-side on firewall:update (admin/owner).
 */

import { useEffect, useState } from "react";

import { EarthIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  SettingsFooter,
  SettingsRow,
  SettingsSection,
} from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

export function GlobalOptionsEditor({ projectId }: { projectId: string }) {
  const query = useQuery(
    orpc.project.proxyRoute.globalOptions.queryOptions({
      input: { projectId: projectId as never },
    }),
  );

  const [acmeEmail, setAcmeEmail] = useState("");
  const [httpsAutoRedirect, setHttpsAutoRedirect] = useState(true);

  // Hydrate once the saved options arrive (and on project switch).
  useEffect(() => {
    if (!query.data) return;
    setAcmeEmail(query.data.acmeEmail ?? "");
    setHttpsAutoRedirect(query.data.httpsAutoRedirect);
  }, [query.data]);

  const save = useMutation({
    ...orpc.project.proxyRoute.setGlobalOptions.mutationOptions(),
    onSuccess: () => {
      toast.success("Global options saved", {
        description: "Edge proxy reconciled.",
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.project.proxyRoute.globalOptions.key({
          input: { projectId: projectId as never },
        }),
      });
    },
    onError: (e) => toast.error(e.message ?? "Failed to save global options"),
  });

  const dirty =
    (query.data?.acmeEmail ?? "") !== acmeEmail ||
    (query.data?.httpsAutoRedirect ?? true) !== httpsAutoRedirect;

  if (query.isLoading) {
    return (
      <div className="max-w-2xl">
        <Skeleton className="mb-3 h-8 w-40" />
        <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
          <Skeleton className="h-16 w-full rounded-none" />
          <Skeleton className="h-16 w-full rounded-none" />
          <Skeleton className="h-12 w-full rounded-none" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <SettingsSection
        icon={EarthIcon}
        title="Global options"
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
              disabled={save.isPending}
            />
          }
        />
        <SettingsRow
          title="Automatic HTTPS redirect"
          description="Redirect HTTP→HTTPS at the edge (Caddy default). Turn off if a downstream load balancer already terminates and redirects TLS."
          control={
            <Switch
              checked={httpsAutoRedirect}
              disabled={save.isPending}
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
                projectId: projectId as never,
                acmeEmail: acmeEmail.trim() === "" ? null : acmeEmail.trim(),
                httpsAutoRedirect,
              })
            }
          >
            {save.isPending ? "Saving…" : "Save & apply"}
          </Button>
        </SettingsFooter>
      </SettingsSection>
    </div>
  );
}
