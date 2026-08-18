import { useEffect, useRef, useState } from "react";

/**
 * Presentational pieces for {@link UpdateProgress}. Split out so the pane
 * component itself stays under the line/complexity budget.
 */
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { LogLineRow, type LogLine } from "@/features/logs/components/log-viewer";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";

import { STEPS, type CancelMutation, type Outcome } from "./update-progress-model";

function dotClass(errored: boolean, done: boolean, active: boolean): string {
  const base = "size-1.5 rounded-full";
  if (errored) return `${base} bg-destructive`;
  if (done) return `${base} bg-success`;
  if (active) return `${base} animate-pulse bg-warning`;
  return `${base} bg-muted-foreground/25`;
}

function labelClass(errored: boolean, lit: boolean): string {
  if (errored) return "text-destructive";
  return lit ? "text-foreground/80" : "text-muted-foreground/50";
}

export function PhaseStepper({ current, failed }: { current: number; failed: boolean }) {
  const { t } = useTranslation();
  return (
    <ol className="flex items-center gap-1.5 text-[10px] font-medium">
      {STEPS.map((step, i) => {
        const done = i < current || (!failed && current === STEPS.length - 1 && i === current);
        const active = i === current && !done;
        const errored = failed && i === current;
        return (
          <li key={step.key} className="flex min-w-0 items-center gap-1.5">
            <span className={dotClass(errored, done, active)} />
            <span className={labelClass(errored, done || active)}>{t(step.labelKey)}</span>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The update log tail. Follows the newest line only while the reader is at
 * the bottom; scrolling up hands the position over to them (the same contract
 * as the shared LogViewer), with a quiet jump-back affordance instead of the
 * old forced `scrollTop = scrollHeight` on every line.
 */
export function LogPane({ lines }: { lines: LogLine[] }) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 4);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [lines.length, pinned]);

  const jumpToLatest = () => {
    const el = viewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setPinned(true);
  };

  return (
    <div className="relative">
      <ScrollArea
        viewportRef={viewportRef}
        className="h-[320px] rounded-md border bg-terminal font-mono text-[11px] leading-relaxed text-terminal-foreground/85"
      >
        <div className="p-3">
          {lines.length === 0 ? (
            <div className="text-muted-foreground/60">{t("updates.starting")}</div>
          ) : (
            lines.map((l) => <LogLineRow key={l.id} line={l} />)
          )}
        </div>
      </ScrollArea>
      {!pinned && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute right-4 bottom-3 inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 font-sans text-[11px] text-foreground/80 shadow-sm hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3" aria-hidden />
          {t("updates.jumpToLatest")}
        </button>
      )}
    </div>
  );
}

export function UpdateOutcome({
  outcome,
  target,
  dryRun,
  onDone,
  cancel,
  error,
  handedOff,
}: {
  outcome: Outcome;
  target: string;
  dryRun: boolean;
  onDone: () => void;
  cancel: CancelMutation;
  error: string | null;
  handedOff: boolean;
}) {
  const { t } = useTranslation();
  const handleCancel = () =>
    cancel.mutate(
      {},
      {
        onSuccess: (res) => {
          toast.message(res.cancelled ? t("updates.resetOk") : t("updates.resetNone"));
          onDone();
        },
        onError: (e) => toast.error(e.message ?? t("updates.resetFailed")),
      },
    );

  if (outcome.failed) {
    // First line only: a failed helper's error carries its whole output, and
    // that detail already lives in the log pane above.
    const brief = error?.split("\n")[0] ?? t("updates.failedFallback");
    return (
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] text-destructive">{brief}</span>
        <Button type="button" size="sm" variant="outline" onClick={onDone} className="shrink-0">
          {t("common.close")}
        </Button>
      </div>
    );
  }
  if (outcome.dryDone) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-success">{t("updates.dryDone")}</span>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          {t("common.done")}
        </Button>
      </div>
    );
  }
  if (outcome.realDone) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-success">{t("updates.realDone", { target })}</span>
        {/* Reload, don't just close: this document was served by the PREVIOUS
            version, so dismissing the dialog leaves the operator driving the new
            control plane through the old bundle. `realDone` is real-cutover only
            (a dry run never sets it), so this is never a gratuitous reload.
            The auto-reload in useCutoverRecovery normally beats the operator
            here: this is the path for when it was blocked or unmounted. */}
        <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
          {t("common.done")}
        </Button>
      </div>
    );
  }
  if (dryRun) return null; // still simulating; the stepper shows activity

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11.5px] text-muted-foreground/70">
        {handedOff ? t("updates.waitingCutover", { target }) : t("updates.applying")}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={cancel.isPending}
        onClick={handleCancel}
        className="shrink-0 text-muted-foreground"
      >
        {cancel.isPending ? t("updates.resetting") : t("updates.resetStuck")}
      </Button>
    </div>
  );
}
