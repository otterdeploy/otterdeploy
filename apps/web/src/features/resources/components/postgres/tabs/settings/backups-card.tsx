/**
 * Snapshots of THIS database, and the restore that reads from them.
 *
 * Restore used to be reachable only from the global Backups page, as an
 * unlabelled icon on a backup row, which is backwards. "Restore" is something
 * you do to a database, so it belongs on the database, next to everything else
 * that acts on it.
 *
 * Scope note: `backups.restore` takes only `{ id, mode, confirm }`. It restores
 * a snapshot in place, over the source it was taken from. Restoring one
 * database's snapshot INTO a different database would need a target on that
 * contract, so this deliberately lists only this resource's own snapshots
 * rather than offering a cross-database import the API can't honour.
 */

import { useMemo, useState } from "react";

import { DatabaseRestoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";

import { backupsCollection, type Backup } from "@/features/backups/data/backups";
import { RestoreWizard } from "@/features/backups/restore-wizard";
import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";

export function BackupsCard({ resourceId }: { resourceId: string }) {
  const [restoreFor, setRestoreFor] = useState<Backup | null>(null);
  const { data: allBackups } = useLiveQuery((q) => q.from({ b: backupsCollection }));

  // Only this database's own snapshots, newest first, and only ones that
  // actually completed: a running or failed run has nothing to restore from.
  const snapshots = useMemo(
    () =>
      allBackups
        .filter((b) => b.resourceId === resourceId && b.status === "succeeded")
        .sort((a, z) => new Date(z.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [allBackups, resourceId],
  );

  return (
    <SettingsCard
      title="Snapshots"
      description="Restore this database from one of its backups. The restore overwrites the live database. You confirm by typing its name."
    >
      {snapshots.length === 0 ? (
        <p className="px-4 py-3 text-[12px] text-muted-foreground">
          No completed snapshots yet. Run a backup for this database from the Backups page, or
          attach it to a schedule.
        </p>
      ) : (
        <ul className="divide-y">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm text-foreground">
                  {new Date(snapshot.createdAt).toLocaleString()}
                </span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {snapshot.destinationName ?? "–"}
                  {snapshot.method ? ` · ${snapshot.method}` : ""}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-8 gap-1.5"
                onClick={() => setRestoreFor(snapshot)}
              >
                <HugeiconsIcon icon={DatabaseRestoreIcon} strokeWidth={2} className="size-3.5" />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      <RestoreWizard
        backup={restoreFor}
        open={restoreFor !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreFor(null);
        }}
      />
    </SettingsCard>
  );
}
