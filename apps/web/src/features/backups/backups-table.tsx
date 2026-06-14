/** The backups runs table — header, rows, and a footer summary. */
import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import type { Backup } from "./data/backups";
import { BACKUP_COLS, BackupRow } from "./backup-row";
import { fmtBytes } from "./shared";

export function BackupsTable({
  backups,
  total,
  onRestore,
}: {
  backups: Backup[];
  total: number;
  onRestore: (b: Backup) => void;
}) {
  const inViewBytes = backups.reduce(
    (acc, b) => acc + (b.compressedSizeBytes ?? 0),
    0,
  );

  return (
    <div className="mb-8 overflow-hidden rounded-md border bg-card">
      <div
        className={cn(
          "grid items-center gap-2 border-b bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground",
          BACKUP_COLS,
        )}
      >
        <span>Source</span>
        <span>Project</span>
        <span>When</span>
        <span>Duration</span>
        <span>Size</span>
        <span>Destination</span>
        <span>Encryption</span>
        <span>Status</span>
        <span />
      </div>

      {backups.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          {total === 0
            ? "No backups yet. Run one or create a schedule to get started."
            : "No backups match these filters."}
        </div>
      ) : (
        backups.map((b) => (
          <BackupRow key={b.id} backup={b} onRestore={onRestore} />
        ))
      )}

      <div className="flex items-center gap-1.5 border-t bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <HugeiconsIcon icon={Folder01Icon} className="size-3" />
        <span>
          {backups.length} of {total} backup{total === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <span className="font-mono">{fmtBytes(inViewBytes)} in view</span>
      </div>
    </div>
  );
}
