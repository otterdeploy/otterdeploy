/**
 * Stages a database deletion in the project manifest. The actual swarm
 * teardown happens when the user clicks Deploy on the pending-changes
 * bar (manifest.apply). This way deletes surface in the same place as
 * every other pending change — no second code path.
 */

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";

import type { PostgresBodyProps } from "../../types";

interface DangerZoneProps {
  resource: PostgresBodyProps["resource"];
  onDeleted: () => void;
}

export function DangerZone({ resource, onDeleted }: DangerZoneProps) {
  const stage = useStageManifestChange(resource.projectId);
  const stageDelete = () => {
    stage.mutate(
      (current) => {
        const remaining = { ...current.databases };
        delete remaining[resource.name];
        return { ...current, databases: remaining };
      },
      { onSuccess: () => onDeleted() },
    );
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
        <TypedConfirmDialog
          trigger={
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
              Delete
            </Button>
          }
          title={`Delete ${resource.name}?`}
          description="This permanently destroys the database, its volume, and the associated proxy route."
          confirmPhrase={resource.name}
          confirmLabel="Delete"
          pendingLabel="Staging…"
          pending={stage.isPending}
          onConfirm={stageDelete}
        />
      </div>
    </SettingsCard>
  );
}
