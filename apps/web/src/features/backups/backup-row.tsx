/**
 * One backup run in the runs table, with an expandable detail drawer. Offers
 * restore (opens the wizard) and a direct download of the produced archive.
 */
import { useState } from "react";

import {
  ArrowRight01Icon,
  Download01Icon,
  Refresh01Icon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

import type { Backup } from "./data/backups";

import { BackupDetail } from "./backup-detail";
import { restoreBackup } from "./data/backups";
import {
  StatusBadge,
  ProjectTagBadge,
  absTime,
  backupWhen,
  destIcon,
  downloadBase64,
  encLabel,
  fmtBytes,
  fmtDuration,
  kindIcon,
  kindLabel,
  relTime,
} from "./shared";

const COLS = "grid-cols-[2.4fr_1.2fr_1.1fr_80px_80px_1.1fr_120px_110px_120px]";

export function BackupRow({
  backup: b,
  onRestore,
}: {
  backup: Backup;
  onRestore: (backup: Backup) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const KIcon = kindIcon(b.kind);
  const DIcon = destIcon(b.destinationType ?? "s3");
  const succeeded = b.status === "succeeded";

  const download = () => {
    setDownloading(true);
    restoreBackup({ id: b.id, mode: "download" })
      .then((res) => {
        if (res.data && res.filename) downloadBase64(res.data, res.filename);
        else toast.error("Backup archive is unavailable");
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Download failed"))
      .finally(() => setDownloading(false));
  };

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        className={cn("grid w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30", COLS)}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={KIcon} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs font-medium">{b.source ?? b.resourceId}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {kindLabel(b.kind)}
          </span>
        </span>
        <span>
          <ProjectTagBadge id={b.project ?? "—"} />
        </span>
        <span
          className="font-mono text-[11px] text-muted-foreground"
          title={absTime(backupWhen(b))}
        >
          {relTime(backupWhen(b))}
        </span>
        <span className="font-mono text-[11px] text-foreground/80">
          {fmtDuration(b.durationMs)}
        </span>
        <span className="font-mono text-[11px] text-foreground/80">
          {fmtBytes(b.compressedSizeBytes)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon icon={DIcon} className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-[11px] text-foreground/80">
            {b.destinationName ?? "—"}
          </span>
        </span>
        <span>
          {b.encryption !== "none" ? (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-500">
              <HugeiconsIcon icon={SquareLock01Icon} className="size-2.5" />
              {encLabel(b.encryption)}
            </span>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">—</span>
          )}
        </span>
        <span>
          <StatusBadge status={b.status} />
        </span>
        <span
          className="flex items-center justify-end gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Restore"
            disabled={!succeeded}
            onClick={() => onRestore(b)}
          >
            <HugeiconsIcon icon={Refresh01Icon} className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Download"
            disabled={!succeeded || downloading}
            onClick={download}
          >
            <HugeiconsIcon icon={Download01Icon} className="size-3" />
          </Button>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className={cn(
              "ml-1 size-3 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
        </span>
      </button>
      {expanded && <BackupDetail backup={b} />}
    </div>
  );
}

export { COLS as BACKUP_COLS };
