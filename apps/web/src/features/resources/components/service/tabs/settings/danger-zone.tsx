// Stages a service deletion in the project manifest. The swarm
// teardown happens on Deploy via manifest.apply — same path as every
// other pending change, so deletes don't carve out a second code route.

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

interface DangerZoneProps {
  resource: { projectId: string; name: string };
  onDeleted: () => void;
  // Pending-create mode: the service was never provisioned, so removing it
  // from the manifest *discards the staged create* rather than tearing down
  // anything live. Same mutation, different framing.
  pending?: boolean;
}

export function ServiceDangerZone({ resource, onDeleted, pending = false }: DangerZoneProps) {
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const current = await orpc.project.manifest.get.call({
        id: resource.projectId,
      });
      const base = current.manifest;
      if (!base) {
        throw new Error("No manifest saved yet — can't stage delete.");
      }
      const remaining = { ...base.services };
      delete remaining[resource.name];
      const next = { ...base, services: remaining };
      await orpc.project.manifest.save.call({
        projectId: resource.projectId,
        manifest: next,
        expectedVersion: current.version,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.diff.queryKey({
            input: { projectId: resource.projectId },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.get.queryKey({
            input: { id: resource.projectId },
          }),
        }),
      ]);
      onDeleted();
    },
    onError: (err) => toast.error(err.message ?? "Failed to stage delete"),
  });

  return (
    <SettingsCard
      title="Danger zone"
      description={
        pending
          ? "This service hasn't been deployed — discarding drops the staged create and its config."
          : "Permanent — the swarm service, proxy routes, and stored env vars are all torn down on the next Deploy."
      }
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium text-destructive">
            {pending ? "Discard this staged service" : "Delete this service"}
          </span>
          <span className="text-[11px] text-muted-foreground">
            <span className="font-mono">{resource.name}</span>
            {pending
              ? " and its staged configuration will be removed."
              : " and all of its stored variables will be removed when the change deploys."}
          </span>
        </div>
        <TypedConfirmDialog
          trigger={
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
              {pending ? "Discard" : "Delete"}
            </Button>
          }
          title={`${pending ? "Discard" : "Delete"} ${resource.name}?`}
          description={
            pending
              ? "This drops the staged service and its configuration."
              : "This stages the deletion of the service, its proxy routes, and its stored env vars."
          }
          confirmPhrase={resource.name}
          confirmLabel={pending ? "Discard" : "Delete"}
          pendingLabel={pending ? "Discarding…" : "Staging…"}
          pending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate()}
        />
      </div>
    </SettingsCard>
  );
}
