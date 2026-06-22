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
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

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
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-8 w-28 self-end" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Global options</h2>
        <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">
          Install-wide edge-proxy settings. Changes apply to every project and
          reconcile the edge immediately.
        </p>
      </div>

      <div className="flex items-start gap-4 border-b border-border/40 pb-4">
        <div className="flex w-48 shrink-0 flex-col">
          <span className="text-[13px] font-medium">ACME email</span>
          <span className="text-[11px] text-muted-foreground">
            Registered with Let's Encrypt for cert notices + recovery. Required
            before any public (non-sslip) domain gets a real certificate.
          </span>
        </div>
        <Input
          type="email"
          value={acmeEmail}
          onChange={(e) => setAcmeEmail(e.target.value)}
          placeholder="ops@example.com"
          className="h-9 max-w-sm font-mono text-[12.5px]"
          disabled={save.isPending}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-4">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">
            Automatic HTTPS redirect
          </span>
          <span className="max-w-xl text-[11px] text-muted-foreground">
            Redirect HTTP→HTTPS at the edge (Caddy default). Turn off if a
            downstream load balancer already terminates and redirects TLS.
          </span>
        </div>
        <Switch
          checked={httpsAutoRedirect}
          disabled={save.isPending}
          onCheckedChange={setHttpsAutoRedirect}
        />
      </div>

      <div className="flex justify-end">
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
      </div>
    </div>
  );
}
