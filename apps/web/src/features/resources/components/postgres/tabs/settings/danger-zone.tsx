/**
 * Stages a database deletion in the project manifest. The actual swarm
 * teardown happens when the user clicks Deploy on the pending-changes
 * bar (manifest.apply). This way deletes surface in the same place as
 * every other pending change — no second code path.
 */

import { useState } from "react";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
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

import type { PostgresBodyProps } from "../../types";

interface DangerZoneProps {
  resource: PostgresBodyProps["resource"];
  onDeleted: () => void;
}

export function DangerZone({ resource, onDeleted }: DangerZoneProps) {
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = confirmText.trim() === resource.name;

  const stage = useStageManifestChange(resource.projectId as never);
  const deleteMutation = {
    isPending: stage.isPending,
    mutate: () => {
      stage.mutate(
        (current) => {
          const { [resource.name]: _removed, ...remaining } = current.databases;
          return { ...current, databases: remaining };
        },
        { onSuccess: () => onDeleted() },
      );
    },
  };

  return (
    <SettingsCard
      title="Danger zone"
      description="Permanent — the volume, swarm service, and proxy route are all torn down."
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium text-destructive">Delete this database</span>
          <span className="text-[11px] text-muted-foreground">
            All data in <span className="font-mono">{resource.databaseName}</span> will be
            unrecoverable.
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
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
                Delete
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {resource.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently destroys the database, its volume, and the associated proxy route.
                Type <span className="font-mono text-foreground">{resource.name}</span> to confirm.
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
                  <Button variant="outline" size="sm" disabled={deleteMutation.isPending}>
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
