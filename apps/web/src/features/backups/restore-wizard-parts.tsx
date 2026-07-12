/**
 * Presentational pieces of the restore wizard: the step rail, the mode-picker
 * cards, the Confirm stage (download note vs. typed-name destructive gate)
 * and the footer controls. All wizard state stays in `RestoreWizardBody`.
 */
import { Alert02Icon, Download01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import { Field } from "./shared";

export type RestoreMode = "download" | "in-place";
export type Step = 0 | 1 | 2;

const STEP_LABELS = ["Choose target", "Verify", "Confirm"] as const;

export function StepRail({ step }: { step: Step }) {
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

export function RestoreModeCard({
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

/** The Confirm stage — a plain note for downloads, the typed-name gate for in-place. */
export function ConfirmStep({
  mode,
  source,
  isVolume,
  backupId,
  confirm,
  onConfirmChange,
  typedOk,
}: {
  mode: RestoreMode;
  source: string;
  isVolume: boolean;
  backupId: string;
  confirm: string;
  onConfirmChange: (value: string) => void;
  typedOk: boolean;
}) {
  if (mode === "download") {
    return (
      <div className="rounded-md border bg-muted/30 p-3.5 text-xs text-foreground/80">
        The archive is decrypted and decompressed server-side, then downloaded by your browser.
        Nothing on <span className="font-mono">{source}</span> changes.
      </div>
    );
  }
  return (
    <>
      <div className="flex gap-2 rounded-md border border-rose-500/35 bg-rose-500/10 p-3.5">
        <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 size-3.5 shrink-0 text-rose-500" />
        <p className="text-xs text-foreground/80">
          This overwrites all current data on{" "}
          <span className="font-mono text-rose-500">{source}</span> with snapshot{" "}
          <span className="font-mono">{backupId}</span>. The current state can't be recovered unless
          a separate snapshot exists.
          {isVolume && " The restore is refused while any container still mounts the volume."}
        </p>
      </div>
      <Field label={`Type "${source}" to confirm`}>
        <Input
          className="font-mono"
          value={confirm}
          onChange={(e) => onConfirmChange(e.target.value)}
          placeholder={source}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the typed-name gate is this stage's only input
          autoFocus
        />
      </Field>
      {!typedOk && confirm.length > 0 && (
        <div className="font-mono text-[11px] text-rose-500">Typed name does not match.</div>
      )}
    </>
  );
}

/** Cancel / Back / Continue / run controls along the wizard's bottom edge. */
export function WizardFooter({
  step,
  mode,
  typedOk,
  running,
  onClose,
  onStep,
  onRun,
}: {
  step: Step;
  mode: RestoreMode;
  typedOk: boolean;
  running: boolean;
  onClose: () => void;
  onStep: (step: Step) => void;
  onRun: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t px-5 py-3">
      <div className="flex-1" />
      <Button variant="outline" size="sm" onClick={onClose}>
        Cancel
      </Button>
      {step > 0 && (
        <Button variant="outline" size="sm" onClick={() => onStep((step - 1) as Step)}>
          Back
        </Button>
      )}
      {step < 2 ? (
        <Button size="sm" onClick={() => onStep((step + 1) as Step)}>
          Continue
        </Button>
      ) : (
        <Button
          size="sm"
          className="gap-1.5"
          variant={mode === "in-place" ? "destructive" : "default"}
          disabled={!typedOk || running}
          onClick={onRun}
        >
          <HugeiconsIcon
            icon={mode === "download" ? Download01Icon : Refresh01Icon}
            className="size-3"
          />
          {running ? "Working…" : mode === "download" ? "Download" : "Restore in place"}
        </Button>
      )}
    </div>
  );
}
