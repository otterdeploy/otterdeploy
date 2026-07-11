/**
 * Restore a succeeded backup — three stages: choose a target (download or
 * in-place), Verify (the server re-fetches the stored archive and recomputes
 * its checksum against the recorded one — a real integrity probe, no fake
 * diff), then the typed-name Confirm for the destructive path. The engine
 * supports two modes: download the archive, or restore in place (database
 * dumps via pg_restore, volume archives by replacing the volume contents).
 * "Restore as new" isn't a real engine mode, so it isn't offered.
 */
import { useState } from "react";

import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";

import type { Backup } from "./data/backups";
import type { RestoreMode, Step } from "./restore-wizard-parts";

import { restoreBackup } from "./data/backups";
import { VerifyStep } from "./restore-verify-step";
import { ConfirmStep, RestoreModeCard, StepRail, WizardFooter } from "./restore-wizard-parts";
import { absTime, downloadBase64 } from "./shared";

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

/** Runs the chosen restore mode and reports the outcome; resolves either way. */
function performRestore({
  backup,
  mode,
  confirm,
  isVolume,
  source,
  onClose,
}: {
  backup: Backup;
  mode: RestoreMode;
  confirm: string;
  isVolume: boolean;
  source: string;
  onClose: () => void;
}): Promise<void> {
  return restoreBackup({ id: backup.id, mode, confirm: mode === "in-place" ? confirm : undefined })
    .then((res) => {
      if (mode === "download") {
        if (res.data && res.filename) downloadBase64(res.data, res.filename);
        else toast.error("Backup archive is unavailable");
      } else {
        toast.success(isVolume ? `Restored volume ${source}` : `Restored ${source} in place`);
      }
      onClose();
    })
    .catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    });
}

function RestoreWizardBody({ backup, onClose }: { backup: Backup; onClose: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [mode, setMode] = useState<RestoreMode>("download");
  const [confirm, setConfirm] = useState("");
  const [running, setRunning] = useState(false);

  // The typed-name gate matches the server's expectation: resource name for
  // database runs, volume name for volume runs.
  const source = backup.source ?? backup.volumeName ?? backup.resourceId ?? backup.id;
  const isVolume = backup.kind === "volume";
  const typedOk = mode !== "in-place" || confirm === source;

  const run = () => {
    setRunning(true);
    void performRestore({ backup, mode, confirm, isVolume, source, onClose }).finally(() =>
      setRunning(false),
    );
  };

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-3xl">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">Restore · {source}</DialogTitle>
        <p className="text-xs text-muted-foreground">
          Backup {backup.id} · {absTime(backup.completedAt ?? backup.createdAt)}
        </p>
      </DialogHeader>

      <StepRail step={step} />

      <div className="flex flex-col gap-3 p-5 pt-3">
        {step === 0 && (
          <>
            <RestoreModeCard
              id="download"
              current={mode}
              onSelect={setMode}
              title="Download archive"
              sub="Fetch the decrypted archive to your machine. Nothing on the source changes."
            />
            <RestoreModeCard
              id="in-place"
              current={mode}
              onSelect={setMode}
              danger
              title="Restore in place"
              sub={
                isVolume
                  ? "Replaces the volume's contents with this archive. Refused while any container mounts it. Requires typed-name confirmation."
                  : "Overwrites the current source with this snapshot. Requires typed-name confirmation."
              }
            />
          </>
        )}

        {step === 1 && <VerifyStep key={backup.id} backup={backup} mode={mode} source={source} />}

        {step === 2 && (
          <ConfirmStep
            mode={mode}
            source={source}
            isVolume={isVolume}
            backupId={backup.id}
            confirm={confirm}
            onConfirmChange={setConfirm}
            typedOk={typedOk}
          />
        )}
      </div>

      <WizardFooter
        step={step}
        mode={mode}
        typedOk={typedOk}
        running={running}
        onClose={onClose}
        onStep={setStep}
        onRun={run}
      />
    </DialogContent>
  );
}
