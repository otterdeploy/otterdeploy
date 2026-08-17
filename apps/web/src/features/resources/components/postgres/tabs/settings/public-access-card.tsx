/**
 * Toggle for public exposure of the postgres resource. Calls
 * `project.resource.database.postgres.setPublic` — the backend
 * registers / unregisters the Caddy layer-4 proxy and reconciles.
 */

import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import {
  SettingsCard,
  SettingsRowReadOnly,
} from "@/features/resources/components/_shared/settings-card";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { Spinner } from "@/shared/components/ui/spinner";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { PostgresBodyProps } from "../../types";

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
  const { t } = useTranslation();
  const setPublic = useMutation({
    ...orpc.project.resource.database.postgres.setPublic.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        // The panel reads this resource from the react-db `resourceCollection`,
        // whose cache key is PREFIXED by RESOURCE_COLLECTION_KEY — the bare
        // orpc `resource.list` key this used to invalidate never matched it,
        // so the toggle (and the public URL rows) stayed stale until the
        // collection's slow poll: "Public access enabled" with the switch
        // still visually off.
        queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
        // The backend syncs the manifest's declared publicEnabled with the
        // toggle — refresh the diff so the pending bar drops/updates in step.
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.diff.queryKey({
            input: { projectId: resource.projectId },
          }),
        }),
      ]);
      toast.success(
        resource.publicEnabled
          ? t("resources.publicDisabledToast")
          : t("resources.publicEnabledToast"),
      );
    },
    onError: (err) => toast.error(err.message ?? t("resources.publicUpdateFailed")),
  });

  const stage = useStageManifestChange(resource.projectId, {
    successToast: t("resources.publicAccessStaged"),
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
      projectId: resource.projectId,
      resourceId: resource.resourceId,
      publicEnabled: next,
    });
  };

  return (
    <SettingsCard
      title={t("resources.publicAccessTitle")}
      description={t("resources.publicAccessDescription")}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">{t("resources.exposePublicly")}</span>
          <span className="text-[11px] text-muted-foreground">
            {pending
              ? resource.publicEnabled
                ? t("resources.willBeExposedAfterDeploy")
                : t("resources.internalNetworkOnly")
              : resource.publicEnabled
                ? t("resources.reachableAt", { host: resource.publicHostname })
                : t("resources.internalOnlyAt", {
                    host: `${resource.internalHostname}:${resource.internalPort}`,
                  })}
          </span>
        </div>
        <span className="flex items-center gap-2">
          {/* Wiring the Caddy layer-4 proxy takes a beat — show the work,
              or the toggle reads as a dead control until the refetch lands. */}
          {(pending ? stage.isPending : setPublic.isPending) && (
            <Spinner className="size-3.5 text-muted-foreground" />
          )}
          <Switch
            checked={resource.publicEnabled}
            disabled={pending ? stage.isPending : setPublic.isPending}
            onCheckedChange={onToggle}
          />
        </span>
      </div>
      {!pending && resource.publicEnabled && (
        <>
          <SettingsRowReadOnly
            label={t("resources.publicEndpoint")}
            value={resource.publicHostname}
          />
          <SettingsRowReadOnly
            label={t("resources.publicConnectionUrl")}
            value={resource.publicConnectionString}
          />
        </>
      )}
    </SettingsCard>
  );
}
