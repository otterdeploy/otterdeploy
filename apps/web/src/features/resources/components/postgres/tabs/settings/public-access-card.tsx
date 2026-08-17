/**
 * Toggle for public exposure of the postgres resource. Calls
 * `project.resource.database.postgres.setPublic`: the backend
 * registers / unregisters the Caddy layer-4 proxy and reconciles.
 *
 * Wiring the proxy takes a beat, so the card reports that beat itself: the
 * switch moves on click, a spinner sits beside it, and the subtext says which
 * way it is going. The endpoint rows stay gated on real server state, so the
 * URL appears exactly when it starts working and never a moment before.
 */

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import {
  SettingsCard,
  SettingsRowReadOnly,
} from "@/features/resources/components/_shared/settings-card";
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
  // What the operator just asked for, held only while the call is in flight.
  // The switch renders from this so it moves on click instead of snapping back
  // to the stale server value for the second or two the proxy takes to wire.
  const [requested, setRequested] = useState<boolean | null>(null);

  const setPublic = useMutation({
    ...orpc.project.resource.database.postgres.setPublic.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.project.resource.list.queryKey({
            input: { projectId: resource.projectId },
          }),
        }),
        // The backend syncs the manifest's declared publicEnabled with the
        // toggle: refresh the diff so the pending bar drops/updates in step.
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.diff.queryKey({
            input: { projectId: resource.projectId },
          }),
        }),
      ]);
      // No success toast. The switch, the subtext and the endpoint rows below
      // already say what happened, and they say it where the operator is
      // looking. A toast here only repeats them a beat late.
    },
    onError: (err) => toast.error(err.message ?? "Failed to update public access"),
    // Cleared after the invalidation above resolves, so the switch hands back
    // to server truth only once that truth has actually arrived.
    onSettled: () => setRequested(null),
  });

  const stage = useStageManifestChange(resource.projectId, {
    successToast: "Public access staged. Deploy to apply.",
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
    setRequested(next);
    setPublic.mutate({
      projectId: resource.projectId,
      resourceId: resource.resourceId,
      publicEnabled: next,
    });
  };

  const busy = pending ? stage.isPending : setPublic.isPending;
  const shown = requested ?? resource.publicEnabled;

  const subtext = () => {
    if (busy && requested !== null) {
      return requested ? "Wiring the Caddy proxy…" : "Removing the public route…";
    }
    if (pending) {
      return resource.publicEnabled
        ? "Will be exposed on the public internet after deploy"
        : "Internal network only";
    }
    return resource.publicEnabled
      ? `Reachable at ${resource.publicHostname}`
      : `Internal-only at ${resource.internalHostname}:${resource.internalPort}`;
  };

  return (
    <SettingsCard
      title="Public access"
      description="Off keeps the DB on the internal network only. On wires the Caddy layer-4 proxy and exposes the public hostname to the open internet."
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-medium">Expose publicly</span>
          <span className="truncate text-[11px] text-muted-foreground">{subtext()}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy && <Spinner className="size-3.5 text-muted-foreground" />}
          <Switch checked={shown} disabled={busy} onCheckedChange={onToggle} />
        </div>
      </div>
      {!pending && resource.publicEnabled && (
        <>
          <SettingsRowReadOnly label="Public endpoint" value={resource.publicHostname} />
          <SettingsRowReadOnly
            label="Public connection URL"
            value={resource.publicConnectionString}
          />
        </>
      )}
    </SettingsCard>
  );
}
