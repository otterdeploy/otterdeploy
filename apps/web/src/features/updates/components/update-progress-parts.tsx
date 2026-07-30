import { useEffect, useState } from "react";

/**
 * Presentational + pure helpers for {@link UpdateProgress}. Split out so the
 * pane component itself stays under the line/complexity budget.
 */
import { env } from "@otterdeploy/env/web";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { LogLineRow, type LogLine } from "@/features/logs/components/log-viewer";
import { Button } from "@/shared/components/ui/button";

import type { useCancelUpdate } from "../data/use-update-status";

export type UpdatePhase = "validate" | "pull" | "migrate" | "recreate" | "handoff" | "done";
export type RunStatus = "idle" | "running" | "succeeded" | "failed";

import { STEPS, phaseIndex, type CancelMutation, type Outcome } from "./update-progress-model";

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
  return (
    <ol className="flex items-center gap-1.5 text-[10px] font-medium">
      {STEPS.map((step, i) => {
        const done = i < current || (!failed && current === STEPS.length - 1 && i === current);
        const active = i === current && !done;
        const errored = failed && i === current;
        return (
          <li key={step.key} className="flex min-w-0 items-center gap-1.5">
            <span className={dotClass(errored, done, active)} />
            <span className={labelClass(errored, done || active)}>{step.label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export function ProgressHeader({
  dryRun,
  target,
  showActivity,
}: {
  dryRun: boolean;
  target: string;
  showActivity: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground/70 uppercase">
        {dryRun ? "Simulating update" : "Updating"} → {target}
      </span>
      {showActivity && (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-warning" />
          {dryRun ? "running" : "applying"}
        </span>
      )}
    </div>
  );
}

export function LogPane({
  lines,
  scrollRef,
}: {
  lines: LogLine[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <div
      ref={scrollRef}
      className="h-[320px] overflow-auto rounded-md border bg-terminal p-2.5 font-mono text-[11px] leading-relaxed text-terminal-foreground/85"
    >
      {lines.length === 0 ? (
        <div className="text-muted-foreground/60">{t("updates.starting")}</div>
      ) : (
        lines.map((l) => <LogLineRow key={l.id} line={l} />)
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
}: {
  outcome: Outcome;
  target: string;
  dryRun: boolean;
  onDone: () => void;
  cancel: CancelMutation;
  error: string | null;
}) {
  const handleCancel = () =>
    cancel.mutate(
      {},
      {
        onSuccess: (res) => {
          toast.message(
            res.cancelled ? "Update reset — you can start it again." : "No update was running.",
          );
          onDone();
        },
        onError: (e) => toast.error(e.message ?? "Couldn't reset the update"),
      },
    );

  if (outcome.failed) {
    return (
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] text-destructive">
          {error ?? "The update did not complete."}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Close
        </Button>
      </div>
    );
  }
  if (outcome.dryDone) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-success">
          Simulated update complete. No containers were changed.
        </span>
        {/* Reloads, like the real-cutover Done below it.
            Nothing changed in a dry run, so a reload is not strictly needed —
            but dev is dry-run by default (resolveDryRun: NODE_ENV !==
            "production"), which makes this the ONLY Done anyone sees while
            developing. Leaving it as close-only meant the reload could not be
            observed in the one environment it was being tested in, and the
            button read as broken. One behaviour for one label beats a
            distinction the operator cannot see. */}
        <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
          Done
        </Button>
      </div>
    );
  }
  if (outcome.realDone) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-success">Update to {target} complete.</span>
        {/* Reload, don't just close: this document was served by the PREVIOUS
            version, so dismissing the dialog leaves the operator driving the new
            control plane through the old bundle. `realDone` is real-cutover only
            (a dry run never sets it), so this is never a gratuitous reload.
            The auto-reload in useCutoverRecovery normally beats the operator
            here — this is the path for when it was blocked or unmounted. */}
        <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
          Done
        </Button>
      </div>
    );
  }
  if (dryRun) return null; // still simulating — the header shows activity

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11.5px] text-muted-foreground/70">
        Waiting for the control plane to come back on {target}. This page will reload automatically.
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={cancel.isPending}
        onClick={handleCancel}
        className="shrink-0 text-muted-foreground"
      >
        {cancel.isPending ? "Resetting…" : "Reset stuck update"}
      </Button>
    </div>
  );
}
