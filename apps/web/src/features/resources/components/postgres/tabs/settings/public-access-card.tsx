/**
 * Toggle for public exposure of the postgres resource. Calls
 * `project.resource.database.postgres.setPublic` — the backend
 * registers / unregisters the Caddy layer-4 proxy and reconciles.
 */

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";
import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";

import type { PostgresBodyProps } from "../../types";
import { SettingsCard, SettingsRowReadOnly } from "@/features/resources/components/_shared/settings-card";

export function PublicAccessCard({
  resource,
  pending = false,
  dbName,
}: {
  resource: PostgresBodyProps["resource"];
  // Pending-create mode: toggle stages `databases[dbName].publicEnabled` onto
  // the manifest instead of wiring the live Caddy proxy.
  pending?: boolean;
  dbName?: string;
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

  const stage = useStageManifestChange(resource.projectId as never, {
    successToast: "Public access staged — Deploy to apply",
  });

  const onToggle = (next: boolean) => {
    if (pending && dbName) {
      void stage.mutateAsync((m) => {
        const db = m.databases[dbName];
        if (!db) return m;
        return {
          ...m,
          databases: { ...m.databases, [dbName]: { ...db, publicEnabled: next } },
        };
      });
      return;
    }
    setPublic.mutate({
      projectId: resource.projectId as never,
      resourceId: resource.resourceId as never,
      publicEnabled: next,
    });
  };

  return (
    <SettingsCard
      title="Public access"
      description="Off keeps the DB on the internal network only. On wires the Caddy layer-4 proxy and exposes the public hostname to the open internet."
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Expose publicly</span>
          <span className="text-[11px] text-muted-foreground">
            {pending
              ? resource.publicEnabled
                ? "Will be exposed on the public internet after deploy"
                : "Internal network only"
              : resource.publicEnabled
                ? `Reachable at ${resource.publicHostname}`
                : `Internal-only at ${resource.internalHostname}:${resource.internalPort}`}
          </span>
        </div>
        <Switch
          checked={resource.publicEnabled}
          disabled={pending ? stage.isPending : setPublic.isPending}
          onCheckedChange={onToggle}
        />
      </div>
      {!pending && resource.publicEnabled && (
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
