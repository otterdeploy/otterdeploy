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
import { useTranslation } from "react-i18next";

import { resourceCollection } from "@/features/resources/data/resource";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import type { Backup } from "./data/backups";
import type { RestoreMode, Step } from "./restore-wizard-parts";

import { VerifyStep } from "./restore-verify-step";
import { performRestore, useRestoreTarget } from "./restore-wizard-logic";
import { ConfirmStep, RestoreModeCard, StepRail, WizardFooter } from "./restore-wizard-parts";
import { absTime } from "./shared";

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
  const { t } = useTranslation();
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
      t,
    }).finally(() => setRunning(false));
  };

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-3xl">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">
          {t("backups.restoreDialogTitle", { source })}
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          {t("backups.backupMeta", {
            id: backup.id,
            when: absTime(backup.completedAt ?? backup.createdAt),
          })}
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
              title={t("backups.downloadTitle")}
              sub={t("backups.downloadSub")}
            />
            {/* A physical base backup restores by extracting into a fresh
                data directory with the server stopped: the destructive modes
                are not offered because the server would refuse them anyway. */}
            {backup.approach === "physical" ? (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                This is a physical pg_basebackup cluster tar. Download it and extract into a fresh
                PostgreSQL data directory; in-place restore doesn't apply.
              </p>
            ) : (
              <RestoreModeCard
                id="in-place"
                current={mode}
                onSelect={setMode}
                danger
                title={t("backups.inPlaceTitle")}
                sub={isVolume ? t("backups.inPlaceSubVolume") : t("backups.inPlaceSubDatabase")}
              />
            )}
            {/* A volume snapshot has no database target, so this is offered
                only for database backups — and only when the project has
                another database of the same engine to restore into. */}
            {!isVolume && backup.approach !== "physical" && targets.length > 0 && (
              <>
                <RestoreModeCard
                  id="into"
                  current={mode}
                  onSelect={setMode}
                  danger
                  title={t("backups.intoTitle")}
                  sub={t("backups.intoSub")}
                />
                {mode === "into" && (
                  <div className="flex flex-col gap-1 pl-3 text-[12px]">
                    <span className="text-muted-foreground">{t("backups.targetDatabase")}</span>
                    <Select
                      items={targets.map((db) => ({ value: db.resourceId, label: db.name }))}
                      value={targetResourceId === "" ? null : targetResourceId}
                      onValueChange={(v) => {
                        setTargetResourceId(typeof v === "string" ? v : "");
                        // The typed gate guards the target's name, so a
                        // change here must invalidate what was already typed.
                        setConfirm("");
                      }}
                    >
                      <SelectTrigger
                        className="h-8 w-full text-[13px]"
                        aria-label={t("backups.targetDatabase")}
                      >
                        <SelectValue placeholder={t("backups.selectDatabase")} />
                      </SelectTrigger>
                      <SelectContent>
                        {targets.map((db) => (
                          <SelectItem key={db.resourceId} value={db.resourceId}>
                            {db.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
