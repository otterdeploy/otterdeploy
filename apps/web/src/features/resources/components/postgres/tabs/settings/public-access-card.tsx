/**
 * Toggle for public exposure of the postgres resource. Calls
 * `project.resource.database.postgres.setPublic` — the backend
 * registers / unregisters the Caddy layer-4 proxy and reconciles.
 */

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { PostgresBodyProps } from "../../types";
import { SettingsCard, SettingsRowReadOnly } from "@/features/resources/components/_shared/settings-card";

export function PublicAccessCard({
  resource,
}: {
  resource: PostgresBodyProps["resource"];
}) {
  const setPublic = useMutation({
    ...orpc.project.resource.database.postgres.setPublic.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: resource.projectId as never },
        }),
      });
      toast.success(
        resource.publicEnabled ? "Public access disabled" : "Public access enabled",
      );
    },
    onError: (err) =>
      toast.error(err.message ?? "Failed to update public access"),
  });

  return (
    <SettingsCard
      title="Public access"
      description="Off keeps the DB on the internal network only. On wires the Caddy layer-4 proxy and exposes the public hostname to the open internet."
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Expose publicly</span>
          <span className="text-[11px] text-muted-foreground">
            {resource.publicEnabled
              ? `Reachable at ${resource.publicHostname}`
              : `Internal-only at ${resource.internalHostname}:${resource.internalPort}`}
          </span>
        </div>
        <Switch
          checked={resource.publicEnabled}
          disabled={setPublic.isPending}
          onCheckedChange={(next) =>
            setPublic.mutate({
              projectId: resource.projectId as never,
              resourceId: resource.resourceId as never,
              publicEnabled: next,
            })
          }
        />
      </div>
      {resource.publicEnabled && (
        <>
          <SettingsRowReadOnly
            label="Public endpoint"
            value={resource.publicHostname}
          />
          <SettingsRowReadOnly
            label="Public connection URL"
            value={resource.publicConnectionString}
          />
        </>
      )}
    </SettingsCard>
  );
}
