/**
 * Restore a succeeded backup — three stages: choose a target (download or
 * in-place), Verify (the server re-fetches the stored archive and recomputes
 * its checksum against the recorded one — a real integrity probe, no fake
 * diff), then the typed-name Confirm for the destructive path. The engine
 * supports two modes: download the archive, or restore in place (database
 * dumps via pg_restore, volume archives by replacing the volume contents).
 * A third target restores INTO ANOTHER existing database — the API's
 * `targetResourceId`. It rides the same `in-place` mode with a target attached;
 * the typed-name gate then guards the TARGET's name, since the target is what
 * gets overwritten. Only same-engine database resources are offered, and volume
 * snapshots have no database target at all.
 */
import { useState } from "react";

import { useLiveQuery } from "@tanstack/react-db";
import { toast } from "sonner";

import { resourceCollection } from "@/features/resources/data/resource";
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
  targetResourceId,
  targetName,
  onClose,
}: {
  backup: Backup;
  mode: RestoreMode;
  confirm: string;
  isVolume: boolean;
  source: string;
  targetResourceId?: string;
  targetName?: string;
  onClose: () => void;
}): Promise<void> {
  // `into` is `in-place` plus a target — the server has one destructive mode,
  // and `targetResourceId` is what redirects it.
  return restoreBackup({
    id: backup.id,
    mode: mode === "download" ? "download" : "in-place",
    confirm: mode === "download" ? undefined : confirm,
    ...(mode === "into" && targetResourceId ? { targetResourceId } : {}),
  })
    .then((res) => {
      if (mode === "download") {
        if (res.data && res.filename) downloadBase64(res.data, res.filename);
        else toast.error("Backup archive is unavailable");
      } else if (mode === "into") {
        toast.success(`Restored ${source} into ${targetName ?? "the selected database"}`);
      } else {
        toast.success(isVolume ? `Restored volume ${source}` : `Restored ${source} in place`);
      }
      onClose();
    })
    .catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    });
}

/**
 * Which databases this snapshot may be restored INTO, and what the typed
 * confirmation has to match.
 *
 * Extracted from the wizard body because the rule it encodes is easy to get
 * subtly wrong: the typed name always guards WHAT GETS OVERWRITTEN, which is
 * the source for an in-place restore but the TARGET when restoring into
 * another database. Inline among the wizard's other state it read as one more
 * boolean.
 */
function useRestoreTarget({
  allResources,
  backup,
  mode,
  confirm,
  source,
  targetResourceId,
}: {
  allResources: readonly { type: string; resourceId: string; name: string; engine?: string }[];
  backup: Backup;
  mode: RestoreMode;
  confirm: string;
  source: string;
  targetResourceId: string;
}) {
  // Same-engine databases, excluding the snapshot's own source. The server
  // enforces the engine match too; filtering here means the operator is never
  // offered a target that will be refused.
  const sourceDb = allResources.find(
    (r) => r.type === "database" && r.resourceId === backup.resourceId,
  );
  const targets = allResources.filter(
    (r) =>
      r.type === "database" &&
      r.resourceId !== backup.resourceId &&
      (sourceDb ? r.engine === sourceDb.engine : true),
  );
  const target = targets.find((r) => r.resourceId === targetResourceId);
  const targetName = target?.name;
  const overwritten = mode === "into" ? (targetName ?? "") : source;
  const typedOk =
    mode === "download" ||
    (confirm === overwritten && overwritten !== "" && (mode !== "into" || Boolean(target)));

  return { targets, target, targetName, overwritten, typedOk };
}

function RestoreWizardBody({ backup, onClose }: { backup: Backup; onClose: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [mode, setMode] = useState<RestoreMode>("download");
  const [confirm, setConfirm] = useState("");
  const [running, setRunning] = useState(false);
  const [targetResourceId, setTargetResourceId] = useState<string>("");

  const { data: allResources } = useLiveQuery((q) => q.from({ r: resourceCollection }));

  // The typed-name gate matches the server's expectation: resource name for
  // database runs, volume name for volume runs.
  const source = backup.source ?? backup.volumeName ?? backup.resourceId ?? backup.id;
  const isVolume = backup.kind === "volume";

  const { targets, targetName, overwritten, typedOk } = useRestoreTarget({
    allResources,
    backup,
    mode,
    confirm,
    source,
    targetResourceId,
  });

  const run = () => {
    setRunning(true);
    void performRestore({
      backup,
      mode,
      confirm,
      isVolume,
      source,
      targetResourceId,
      targetName,
      onClose,
    }).finally(() => setRunning(false));
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
            {/* A volume snapshot has no database target, so this is offered
                only for database backups — and only when the project has
                another database of the same engine to restore into. */}
            {!isVolume && targets.length > 0 && (
              <>
                <RestoreModeCard
                  id="into"
                  current={mode}
                  onSelect={setMode}
                  danger
                  title="Restore into another database"
                  sub="Seeds a different database from this snapshot. That database's contents are overwritten, not this one's — the typed confirmation names the target."
                />
                {mode === "into" && (
                  <label className="flex flex-col gap-1 pl-3 text-[12px]">
                    <span className="text-muted-foreground">Target database</span>
                    <select
                      className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
                      value={targetResourceId}
                      onChange={(e) => {
                        setTargetResourceId(e.target.value);
                        // The typed gate guards the target's name, so a
                        // change here must invalidate what was already typed.
                        setConfirm("");
                      }}
                    >
                      <option value="">Select a database…</option>
                      {targets.map((t) => (
                        <option key={t.resourceId} value={t.resourceId}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </>
        )}

        {step === 1 && <VerifyStep key={backup.id} backup={backup} mode={mode} source={source} />}

        {step === 2 && (
          <ConfirmStep
            mode={mode}
            source={overwritten}
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
