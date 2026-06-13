// Stages a service deletion in the project manifest. The swarm
// teardown happens on Deploy via manifest.apply — same path as every
// other pending change, so deletes don't carve out a second code route.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";

interface DangerZoneProps {
  resource: { projectId: string; name: string };
  onDeleted: () => void;
}

export function ServiceDangerZone({ resource, onDeleted }: DangerZoneProps) {
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = confirmText.trim() === resource.name;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const current = await orpc.project.manifest.get.call({
        id: resource.projectId as never,
      });
      const base = current.manifest;
      if (!base) {
        throw new Error("No manifest saved yet — can't stage delete.");
      }
      const { [resource.name]: _removed, ...remaining } = base.services;
      const next = { ...base, services: remaining };
      await orpc.project.manifest.save.call({
        projectId: resource.projectId as never,
        manifest: next,
        expectedVersion: current.version,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.diff.queryKey({
            input: { projectId: resource.projectId as never },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.get.queryKey({
            input: { id: resource.projectId as never },
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
      description="Permanent — the swarm service, proxy routes, and stored env vars are all torn down on the next Deploy."
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium text-destructive">
            Delete this service
          </span>
          <span className="text-[11px] text-muted-foreground">
            <span className="font-mono">{resource.name}</span> and all of its
            stored variables will be removed when the change deploys.
          </span>
        </div>
        <AlertDialog
          onOpenChange={(open) => {
            if (!open) setConfirmText("");
          }}
        >
          <AlertDialogTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <HugeiconsIcon
                  icon={Delete02Icon}
                  strokeWidth={2}
                  className="size-3.5"
                />
                Delete
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {resource.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This stages the deletion of the service, its proxy routes, and
                its stored env vars. Type{" "}
                <span className="font-mono text-foreground">
                  {resource.name}
                </span>{" "}
                to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={resource.name}
              className="font-mono"
            />
            <AlertDialogFooter>
              <AlertDialogCancel
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={deleteMutation.isPending}
                  >
                    Cancel
                  </Button>
                }
              />
              <AlertDialogAction
                render={
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!canConfirm || deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate()}
                  >
                    {deleteMutation.isPending ? "Staging…" : "Delete"}
                  </Button>
                }
              />
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SettingsCard>
  );
}
