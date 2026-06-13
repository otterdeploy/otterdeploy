/**
 * Toggle for public exposure of a service resource. Calls
 * `service.expose` / `service.unexpose` — the backend resolves the public
 * domain (resource override → project → org → sslip fallback), registers /
 * unregisters the Caddy HTTP proxy route, and reconciles.
 *
 * Exposing needs a primary HTTP port; services without one come back with a
 * typed NO_HTTP_PORT error, surfaced as a toast (no client-side port data on
 * the panel resource to gate the switch up front).
 */

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

import { SettingsCard, SettingsRowReadOnly } from "@/features/resources/components/_shared/settings-card";

export function ServicePublicAccessCard({
  resource,
}: {
  resource: { projectId: string; resourceId: string; publicEnabled: boolean; publicDomain: string | null };
}) {
  const onSettled = async () => {
    await Promise.all([
      // The rest of the app (networking page, pending-changes bar) reads the
      // resource list via react-query.
      queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: resource.projectId as never },
        }),
      }),
      // The graph panel reads from the on-demand `resourceCollection`, keyed
      // under the "resource" prefix — invalidate it so the switch flips now
      // instead of waiting for the 5s poll.
      queryClient.invalidateQueries({ queryKey: ["resource"] }),
    ]);
  };

  const expose = useMutation({
    ...orpc.service.expose.mutationOptions(),
    onSuccess: () => toast.success("Public access enabled"),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to enable public access"),
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
        <Switch
          checked={resource.publicEnabled}
          disabled={pending}
          onCheckedChange={(next) => {
            const input = {
              projectId: resource.projectId as never,
              resourceId: resource.resourceId as never,
            };
            if (next) expose.mutate(input);
            else unexpose.mutate(input);
          }}
        />
      </div>
      {resource.publicEnabled && resource.publicDomain && (
        <SettingsRowReadOnly
          label="Public endpoint"
          value={`https://${resource.publicDomain}`}
          href={`https://${resource.publicDomain}`}
        />
      )}
    </SettingsCard>
  );
}
