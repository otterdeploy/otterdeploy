/**
 * Destructive delete confirmation for a postgres resource. Tears down
 * the volume, swarm service, and proxy route in one call via the
 * generic `project.resource.delete` procedure.
 */

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

import type { ResourceBodyProps } from "../types";
import { SettingsCard } from "./atoms";

interface DangerZoneProps {
  resource: ResourceBodyProps["resource"];
  onDeleted: () => void;
}

export function DangerZone({ resource, onDeleted }: DangerZoneProps) {
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = confirmText.trim() === resource.name;

  const deleteMutation = useMutation({
    ...orpc.project.resource.delete.mutationOptions(),
    onSuccess: async () => {
      toast.success(`Deleted ${resource.name}`);
      await queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: resource.projectId as never },
        }),
      });
      onDeleted();
    },
    onError: (err) => toast.error(err.message ?? "Failed to delete resource"),
  });

  return (
    <SettingsCard
      title="Danger zone"
      description="Permanent — the volume, swarm service, and proxy route are all torn down."
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium text-destructive">
            Delete this database
          </span>
          <span className="text-[11px] text-muted-foreground">
            All data in <span className="font-mono">{resource.databaseName}</span>{" "}
            will be unrecoverable.
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
                This permanently destroys the database, its volume, and the
                associated proxy route. Type{" "}
                <span className="font-mono text-foreground">{resource.name}</span>{" "}
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
                    onClick={() =>
                      deleteMutation.mutate({
                        projectId: resource.projectId as never,
                        resourceId: resource.resourceId as never,
                      })
                    }
                  >
                    {deleteMutation.isPending ? "Deleting…" : "Delete"}
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
