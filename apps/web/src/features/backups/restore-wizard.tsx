/**
 * Restore a succeeded backup — three stages: choose a target (download or
 * in-place), Verify (the server re-fetches the stored archive and recomputes
 * its checksum against the recorded one — a real integrity probe, no fake
 * diff), then the typed-name Confirm for the destructive path. The engine
 * supports two modes: download the archive, or restore in place (database
 * dumps via pg_restore, volume archives by replacing the volume contents).
 * "Restore as new" isn't a real engine mode, so it isn't offered.
 */
import { useEffect, useState } from "react";

import {
  Alert02Icon,
  CheckmarkCircle01Icon,
  Download01Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import type { Backup, VerifyResult } from "./data/backups";

import { restoreBackup, verifyBackup } from "./data/backups";
import { Field, absTime, downloadBase64, encLabel, fmtBytes } from "./shared";

type RestoreMode = "download" | "in-place";
type Step = 0 | 1 | 2;

const STEP_LABELS = ["Choose target", "Verify", "Confirm"] as const;

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
    restoreBackup({ id: backup.id, mode, confirm: mode === "in-place" ? confirm : undefined })
      .then((res) => {
        if (mode === "download") {
          if (res.data && res.filename) downloadBase64(res.data, res.filename);
          else toast.error("Backup archive is unavailable");
        } else {
          toast.success(isVolume ? `Restored volume ${source}` : `Restored ${source} in place`);
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

        {step === 1 && <VerifyStep backup={backup} mode={mode} source={source} />}

        {step === 2 && (
          <>
            {mode === "download" ? (
              <div className="rounded-md border bg-muted/30 p-3.5 text-xs text-foreground/80">
                The archive is decrypted and decompressed server-side, then downloaded by your
                browser. Nothing on <span className="font-mono">{source}</span> changes.
              </div>
            ) : (
              <>
                <div className="flex gap-2 rounded-md border border-rose-500/35 bg-rose-500/10 p-3.5">
                  <HugeiconsIcon
                    icon={Alert02Icon}
                    className="mt-0.5 size-3.5 shrink-0 text-rose-500"
                  />
                  <p className="text-xs text-foreground/80">
                    This overwrites all current data on{" "}
                    <span className="font-mono text-rose-500">{source}</span> with snapshot{" "}
                    <span className="font-mono">{backup.id}</span>. The current state can't be
                    recovered unless a separate snapshot exists.
                    {isVolume &&
                      " The restore is refused while any container still mounts the volume."}
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
                  <div className="font-mono text-[11px] text-rose-500">
                    Typed name does not match.
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-5 py-3">
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {step > 0 && (
          <Button variant="outline" size="sm" onClick={() => setStep((step - 1) as Step)}>
            Back
          </Button>
        )}
        {step < 2 ? (
          <Button size="sm" onClick={() => setStep((step + 1) as Step)}>
            Continue
          </Button>
        ) : (
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
        )}
      </div>
    </DialogContent>
  );
}

function StepRail({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full font-mono text-[10px]",
              i <= step ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <span className={cn("text-xs", i === step ? "text-foreground" : "text-muted-foreground")}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Server-side integrity check + a plain source → target summary built from
 * what is genuinely stored on the run row. No invented diff.
 */
function VerifyStep({
  backup,
  mode,
  source,
}: {
  backup: Backup;
  mode: RestoreMode;
  source: string;
}) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    verifyBackup(backup.id)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Verification failed");
      });
    return () => {
      cancelled = true;
    };
  }, [backup.id]);

  const checking = !result && !error;

  return (
    <>
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-semibold">Integrity check</span>
          <div className="flex-1" />
          {checking ? (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              re-fetching archive…
            </Badge>
          ) : result?.match === true ? (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-500"
            >
              <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-2.5" />
              checksum match
            </Badge>
          ) : result?.match === false ? (
            <Badge
              variant="outline"
              className="gap-1 border-rose-500/30 bg-rose-500/10 font-mono text-[10px] text-rose-500"
            >
              <HugeiconsIcon icon={Alert02Icon} className="size-2.5" />
              checksum mismatch
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-500"
            >
              <HugeiconsIcon icon={Alert02Icon} className="size-2.5" />
              unverifiable
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
          <span className="break-all">
            stored: {result?.storedChecksum ?? backup.checksum ?? "—"}
          </span>
          {result?.computedChecksum && (
            <span className="break-all">computed: {result.computedChecksum}</span>
          )}
          <span>
            archive:{" "}
            {result?.archiveSizeBytes != null
              ? fmtBytes(result.archiveSizeBytes)
              : fmtBytes(backup.compressedSizeBytes)}{" "}
            at destination · encryption: {encLabel(backup.encryption)}
          </span>
          {(error ?? result?.reason) && (
            <span className="text-amber-500">{error ?? result?.reason}</span>
          )}
        </div>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 font-mono text-[11px] text-muted-foreground">
        <div>source: {backup.sourceService ?? source}</div>
        <div>target: {mode === "in-place" ? source : "(download only)"}</div>
        <div>size: {fmtBytes(backup.sourceSizeBytes)} raw</div>
        <div>method: {backup.method ?? "—"}</div>
        {mode === "in-place" && (
          <div className="text-rose-500">existing data on {source} will be replaced</div>
        )}
      </div>
    </>
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
