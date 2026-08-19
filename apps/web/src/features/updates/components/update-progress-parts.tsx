import { useEffect, useRef, useState } from "react";

/**
 * Presentational pieces for {@link UpdateProgress}, the B1 "Quiet Progress"
 * layout: state leads (headline + segmented phase bar), the log is evidence on
 * demand (heartbeat line + disclosure), and the cutover gets a designed pane
 * of its own. Split out so the pane component stays under the budget.
 */
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { LogLineRow, type LogLine } from "@/features/logs/components/log-viewer";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { cn } from "@/shared/lib/utils";

import { formatClock } from "./update-progress-clock";
import {
  PHASE_HEADLINE_KEYS,
  STEPS,
  type Outcome,
  type UpdatePhase,
} from "./update-progress-model";

/** Headline sentence + expectation sub-line. On failure the first error line
 *  IS the headline: it renders here and nowhere else (the log below carries
 *  the detail, the footer only carries the action). */
export function UpdateHeadline({
  outcome,
  phase,
  dryRun,
  target,
  error,
}: {
  outcome: Outcome;
  phase: UpdatePhase;
  dryRun: boolean;
  target: string;
  error: string | null;
}) {
  const { t } = useTranslation();
  if (outcome.failed) {
    const brief = error?.split("\n")[0] ?? t("updates.failedFallback");
    return (
      <div className="flex flex-col gap-0.5">
        <div className="text-sm font-semibold text-destructive">{brief}</div>
        <div className="text-xs text-muted-foreground">{t("updates.failedDetail")}</div>
      </div>
    );
  }
  const title = outcome.realDone
    ? t("updates.realDone", { target })
    : outcome.dryDone
      ? t("updates.dryDoneTitle")
      : t(PHASE_HEADLINE_KEYS[phase]);
  const sub = outcome.done
    ? outcome.dryDone
      ? t("updates.dryDoneSub")
      : null
    : dryRun
      ? t("updates.runningSubDry")
      : t("updates.runningSubReal", { target });
  return (
    <div className="flex flex-col gap-0.5">
      <div className={cn("text-base font-semibold", outcome.done && "text-success")}>{title}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** The hairline progress bar: one segment per visible step, labels beneath.
 *  Done phases read success, the live one pulses warning, a failure marks the
 *  phase it died in. */
export function SegmentedPhases({ current, failed }: { current: number; failed: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1" role="presentation">
        {STEPS.map((step, i) => (
          <span
            key={step.key}
            className={cn(
              "h-0.75 flex-1 rounded-full bg-foreground/10",
              i < current && "bg-success",
              i === current && (failed ? "bg-destructive" : "bg-warning motion-safe:animate-pulse"),
            )}
          />
        ))}
      </div>
      <ol className="flex gap-1 text-[10px]">
        {STEPS.map((step, i) => (
          <li
            key={step.key}
            className={cn(
              "flex-1 text-muted-foreground/50",
              i === current && (failed ? "text-destructive" : "text-foreground/80"),
            )}
          >
            {t(step.labelKey)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The last log line as a heartbeat, with the disclosure toggle and run clock. */
export function HeartbeatRow({
  line,
  clockMs,
  open,
  onToggle,
}: {
  line: LogLine | null;
  clockMs: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-baseline justify-between gap-3 border-t pt-2.5">
      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/70">
        {line ? (
          <>
            {line.ts && <span className="text-muted-foreground/40">{line.ts} </span>}
            {line.line}
          </>
        ) : (
          t("updates.starting")
        )}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="shrink-0 text-[11.5px] text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {open ? t("updates.hideLog") : t("updates.showLog")} · {formatClock(clockMs)}
      </button>
    </div>
  );
}

/**
 * The update log as disclosed evidence. Follows the newest line only while the
 * reader is at the bottom; scrolling up hands the position over to them, with
 * a quiet jump-back affordance (same contract as the shared LogViewer).
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
        className="h-[240px] rounded-md border bg-terminal font-mono text-[11px] leading-relaxed text-terminal-foreground/85"
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

/** Terminal actions only: the headline already carries the message, so this
 *  row never repeats it. Running state shows nothing until the run has hung
 *  long enough for reset to be plausible. */
export function UpdateFooter({
  outcome,
  onDone,
  showReset,
  resetPending,
  onReset,
}: {
  outcome: Outcome;
  onDone: () => void;
  showReset: boolean;
  resetPending: boolean;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  if (outcome.failed || outcome.dryDone) {
    return (
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          {outcome.failed ? t("common.close") : t("common.done")}
        </Button>
      </div>
    );
  }
  if (outcome.realDone) {
    return (
      <div className="flex justify-end">
        {/* Reload, don't just close: this document was served by the PREVIOUS
            version. The auto-reload in useCutoverRecovery normally beats the
            operator here; this is the path for when it was blocked. */}
        <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
          {t("common.done")}
        </Button>
      </div>
    );
  }
  if (!showReset) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11.5px] text-muted-foreground/70">{t("updates.slowHint")}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={resetPending}
        onClick={onReset}
        className="shrink-0 text-muted-foreground"
      >
        {resetPending ? t("updates.resetting") : t("updates.resetStuck")}
      </Button>
    </div>
  );
}
