/**
 * Toggle for public exposure of a service resource. Calls
 * `service.expose` / `service.unexpose` — the backend resolves the public
 * domain (resource override → project → org → sslip fallback), registers /
 * unregisters the Caddy HTTP proxy route, and reconciles.
 *
 * Exposing needs a primary HTTP port; services without one come back with a
 * typed NO_HTTP_PORT error, surfaced as a toast (no client-side port data on
 * the panel resource to gate the switch up front).
 *
 * A service with no real domain would only be publishable on a throwaway
 * `<slug>.<ip>.sslip.io` URL. Rather than do that silently, the server rejects
 * the first expose with NO_PUBLIC_DOMAIN and hands back the host it *would*
 * mint; we confirm with the operator and only then retry with
 * `allowGeneratedDomain: true`.
 */

import { useState } from "react";

import { ORPCError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { SERVICE_DOMAINS_COLLECTION_KEY } from "@/features/resources/data/service-domains";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Spinner } from "@/shared/components/ui/spinner";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

export function ServicePublicAccessCard({
  resource,
}: {
  resource: {
    projectId: string;
    resourceId: string;
    publicEnabled: boolean;
    publicDomain: string | null;
  };
}) {
  const onSettled = async () => {
    await Promise.all([
      // The rest of the app (networking page, pending-changes bar) reads the
      // resource list via react-query.
      queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: resource.projectId },
        }),
      }),
      // The graph panel reads from the on-demand `resourceCollection`, keyed
      // under its own namespace — invalidate it so the switch flips now
      // instead of waiting for the 5s poll.
      queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
      // The Domains card reads the just-minted (or dropped) public route from
      // `service.domains.list` — invalidate it (and the shared collection
      // prefix) so the resolved hostname appears immediately, not after a
      // manual refresh. Without this the domain the server auto-provisions on
      // expose stays invisible until the query's own refetch.
      queryClient.invalidateQueries({
        queryKey: orpc.service.domains.list.queryKey({
          input: {
            projectId: resource.projectId,
            resourceId: resource.resourceId,
          },
        }),
      }),
      queryClient.invalidateQueries({ queryKey: SERVICE_DOMAINS_COLLECTION_KEY }),
    ]);
  };

  // Host the server would publish this domain-less service on (sslip.io). Set
  // when the first expose is rejected with NO_PUBLIC_DOMAIN — drives the
  // confirm dialog; null keeps it closed.
  const [pendingSslipHost, setPendingSslipHost] = useState<string | null>(null);

  const expose = useMutation({
    ...orpc.service.expose.mutationOptions(),
    onSuccess: () => {
      setPendingSslipHost(null);
      toast.success("Public access enabled");
    },
    onError: (err) => {
      // No real domain — the server is asking us to confirm the temporary
      // sslip.io URL before it publishes on it. Open the dialog instead of
      // surfacing an error toast.
      if (err instanceof ORPCError && err.code === "NO_PUBLIC_DOMAIN") {
        const data = err.data as { generatedDomain?: string } | undefined;
        if (data?.generatedDomain) {
          setPendingSslipHost(data.generatedDomain);
          return;
        }
      }
      toast.error(err instanceof Error ? err.message : "Failed to enable public access");
    },
    onSettled,
  });

  const unexpose = useMutation({
    ...orpc.service.unexpose.mutationOptions(),
    onSuccess: () => toast.success("Public access disabled"),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to disable public access"),
    onSettled,
  });

  const pending = expose.isPending || unexpose.isPending;

  return (
    <SettingsCard
      title="Public access"
      description="Off keeps the service on the internal project network only. On resolves a public hostname and wires the Caddy HTTP route — needs a primary HTTP port."
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Expose publicly</span>
          <span className="text-[11px] text-muted-foreground">
            {resource.publicEnabled && resource.publicDomain
              ? `Reachable at ${resource.publicDomain}`
              : "Internal-only on the project network"}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {pending && <Spinner className="size-3.5 text-muted-foreground" />}
          <Switch
            checked={resource.publicEnabled}
            disabled={pending}
            onCheckedChange={(next) => {
              const input = {
                projectId: resource.projectId,
                resourceId: resource.resourceId,
              };
              // No opt-in on the first attempt: a domain-less service comes
              // back with NO_PUBLIC_DOMAIN and we ask before using sslip.io.
              if (next) expose.mutate(input);
              else unexpose.mutate(input);
            }}
          />
        </div>
      </div>

      <AlertDialog
        open={pendingSslipHost !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSslipHost(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish on a temporary URL?</AlertDialogTitle>
            <AlertDialogDescription>
              This service has no domain yet. Turning on public access will make it reachable at{" "}
              <span className="font-mono text-foreground">{pendingSslipHost}</span> — a temporary
              sslip.io address with a self-signed certificate. Add your own domain below for a
              real, trusted URL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={expose.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                expose.mutate({
                  projectId: resource.projectId,
                  resourceId: resource.resourceId,
                  allowGeneratedDomain: true,
                });
              }}
              disabled={expose.isPending}
            >
              {expose.isPending ? "Enabling…" : "Use temporary URL"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  );
}
