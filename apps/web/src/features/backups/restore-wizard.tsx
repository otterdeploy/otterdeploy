/**
 * Restore a succeeded backup. The engine supports two modes: download the
 * archive, or restore in place (destructive, typed-name confirmed). "Restore as
 * new" isn't a real engine mode, so it isn't offered.
 */
import { useState } from "react";

import { Alert02Icon, Download01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

import type { Backup } from "./data/backups";

import { restoreBackup } from "./data/backups";
import { Field, absTime, downloadBase64, encLabel, fmtBytes } from "./shared";

type RestoreMode = "download" | "in-place";

export function RestoreWizard({
  backup,
  open,
  onOpenChange,
}: {
  backup: Backup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open || !backup) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <RestoreWizardBody backup={backup} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function RestoreWizardBody({ backup, onClose }: { backup: Backup; onClose: () => void }) {
  const [mode, setMode] = useState<RestoreMode>("download");
  const [confirm, setConfirm] = useState("");
  const [running, setRunning] = useState(false);

  const source = backup.source ?? backup.resourceId;
  const typedOk = mode !== "in-place" || confirm === source;

  const run = () => {
    setRunning(true);
    restoreBackup({ id: backup.id, mode, confirm: mode === "in-place" ? confirm : undefined })
      .then((res) => {
        if (mode === "download") {
          if (res.data && res.filename) downloadBase64(res.data, res.filename);
          else toast.error("Backup archive is unavailable");
        } else {
          toast.success(`Restored ${source} in place`);
        }
        onClose();
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Restore failed"))
      .finally(() => setRunning(false));
  };

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-3xl">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">Restore · {source}</DialogTitle>
        <p className="text-xs text-muted-foreground">
          Backup {backup.id} · {absTime(backup.completedAt ?? backup.createdAt)}
        </p>
      </DialogHeader>

      <div className="flex flex-col gap-3 p-5">
        <RestoreModeCard
          id="download"
          current={mode}
          onSelect={setMode}
          title="Download archive"
          sub="Fetch the encrypted archive to your machine. Nothing on the source changes."
        />
        <RestoreModeCard
          id="in-place"
          current={mode}
          onSelect={setMode}
          danger
          title="Restore in place"
          sub="Overwrites the current source with this snapshot. Requires typed-name confirmation."
        />

        <div className="rounded-md border bg-muted/30 p-3 font-mono text-[11px] text-muted-foreground">
          <div>checksum: {backup.checksum ?? "—"}</div>
          <div>encryption: {encLabel(backup.encryption)}</div>
          <div>size: {fmtBytes(backup.compressedSizeBytes)}</div>
        </div>

        {mode === "in-place" && (
          <>
            <div className="flex gap-2 rounded-md border border-rose-500/35 bg-rose-500/10 p-3.5">
              <HugeiconsIcon
                icon={Alert02Icon}
                className="mt-0.5 size-3.5 shrink-0 text-rose-500"
              />
              <p className="text-xs text-foreground/80">
                This overwrites all current data on{" "}
                <span className="font-mono text-rose-500">{source}</span> with snapshot{" "}
                <span className="font-mono">{backup.id}</span>. The current state can't be recovered
                unless a separate snapshot exists.
              </p>
            </div>
            <Field label={`Type "${source}" to confirm`}>
              <Input
                className="font-mono"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={source}
                autoFocus
              />
            </Field>
            {!typedOk && confirm.length > 0 && (
              <div className="font-mono text-[11px] text-rose-500">Typed name does not match.</div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-5 py-3">
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          variant={mode === "in-place" ? "destructive" : "default"}
          disabled={!typedOk || running}
          onClick={run}
        >
          <HugeiconsIcon
            icon={mode === "download" ? Download01Icon : Refresh01Icon}
            className="size-3"
          />
          {running ? "Working…" : mode === "download" ? "Download" : "Restore in place"}
        </Button>
      </div>
    </DialogContent>
  );
}

function RestoreModeCard({
  id,
  current,
  onSelect,
  title,
  sub,
  danger,
}: {
  id: RestoreMode;
  current: RestoreMode;
  onSelect: (m: RestoreMode) => void;
  title: string;
  sub: string;
  danger?: boolean;
}) {
  const active = current === id;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={
        "flex flex-col gap-1 rounded-md border p-3.5 text-left transition-colors " +
        (active
          ? danger
            ? "border-rose-500 bg-rose-500/5"
            : "border-foreground bg-muted/50"
          : "hover:bg-muted/30")
      }
    >
      <div className="flex items-center gap-2">
        <span className={"text-sm font-semibold " + (danger ? "text-rose-500" : "text-foreground")}>
          {title}
        </span>
        {danger && (
          <Badge
            variant="outline"
            className="border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-500"
          >
            destructive
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </button>
  );
}
