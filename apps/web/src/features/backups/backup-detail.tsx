/**
 * Expanded detail drawer for one backup run. Reads its own log lines on demand
 * (real `backups.logs` query — no fake preview).
 */
import { Alert02Icon, DatabaseRestoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { Backup } from "./data/backups";

import { fmtBytes } from "./shared";

export function BackupDetail({
  backup,
  onRestore,
}: {
  backup: Backup;
  onRestore: (backup: Backup) => void;
}) {
  const sourceBytes = backup.sourceSizeBytes ?? 0;
  const compressedBytes = backup.compressedSizeBytes ?? 0;
  const ratio =
    sourceBytes > 0 && compressedBytes > 0
      ? `${((1 - compressedBytes / sourceBytes) * 100).toFixed(0)}%`
      : "—";

  return (
    <div className="border-t bg-muted/30 px-4 py-3.5">
      {/* The row's restore control is a 24px ghost icon with only a tooltip —
          effectively invisible, and a refresh glyph reads as "retry" rather
          than "restore". Restoring a database is the whole point of having
          backups, so it gets a named button where there's room for one. */}
      {backup.status === "succeeded" ? (
        <div className="mb-3.5 flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-8 gap-1.5" onClick={() => onRestore(backup)}>
            <HugeiconsIcon icon={DatabaseRestoreIcon} strokeWidth={2} className="size-3.5" />
            Restore from this backup
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Opens the restore wizard — you choose the target before anything is written.
          </span>
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <DetailField label="Backup ID" value={backup.id} mono />
        <DetailField label="Method" value={backup.method ?? "—"} mono />
        <DetailField label="Retention class" value={backup.retention} />
        {backup.kind === "volume" ? (
          <DetailField label="Source volume" value={backup.volumeName ?? "—"} mono />
        ) : (
          <DetailField
            label="Source service"
            value={`${backup.sourceService ?? "—"} @ ${backup.sourceHost ?? "—"}`}
            mono
          />
        )}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        <DetailField label="Source size" value={fmtBytes(sourceBytes)} mono />
        <DetailField label="Compressed" value={fmtBytes(compressedBytes)} mono />
        <DetailField label="Compression ratio" value={ratio} mono />
      </div>

      <div className="mb-3 flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          Checksum
        </span>
        <code className="rounded border bg-background px-2 py-1.5 font-mono text-[11px] break-all text-foreground/80">
          {backup.checksum ?? "—"}
        </code>
      </div>

      {backup.errorMessage && (
        <div className="mb-3 flex gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2">
          <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 size-3.5 shrink-0 text-rose-500" />
          <div className="font-mono text-[11px] text-rose-500">{backup.errorMessage}</div>
        </div>
      )}

      <BackupLog backupId={backup.id} />
    </div>
  );
}

/** Log lines for one run — owns the on-demand `backups.logs` query. */
function BackupLog({ backupId }: { backupId: string }) {
  const { data: logs = [], isLoading } = useQuery({
    ...orpc.backups.logs.queryOptions({ input: { id: backupId } }),
  });

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        Log {logs.length > 0 ? `· ${logs.length} lines` : ""}
      </span>
      <div className="max-h-40 overflow-auto rounded-md border bg-background p-2.5 font-mono text-[11px] leading-relaxed">
        {isLoading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="text-muted-foreground">No log output.</div>
        ) : (
          logs.map((l) => (
            <div
              key={l.seq}
              className={cn("text-foreground/80", l.stream === "stderr" && "text-rose-500")}
            >
              {l.line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <span className={cn("text-xs break-words text-foreground/80", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}
