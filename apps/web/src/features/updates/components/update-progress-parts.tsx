import { useEffect, useState } from "react";

/**
 * Presentational + pure helpers for {@link UpdateProgress}. Split out so the
 * pane component itself stays under the line/complexity budget.
 */
import { env } from "@otterdeploy/env/web";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { LogLineRow, type LogLine } from "@/features/logs/components/log-viewer";
import { Button } from "@/shared/components/ui/button";

import type { useCancelUpdate } from "../data/use-update-status";

export type UpdatePhase = "validate" | "pull" | "migrate" | "recreate" | "handoff" | "done";
export type RunStatus = "idle" | "running" | "succeeded" | "failed";
type CancelMutation = ReturnType<typeof useCancelUpdate>;

/** Visible steps in order. `handoff` folds into `recreate` for display — it's
 *  the same "restarting the control plane" beat. */
export const STEPS: { key: Exclude<UpdatePhase, "handoff">; label: string }[] = [
  { key: "validate", label: "Validate" },
  { key: "pull", label: "Pull" },
  { key: "migrate", label: "Migrate" },
  { key: "recreate", label: "Recreate" },
  { key: "done", label: "Done" },
];

export function phaseIndex(p: UpdatePhase): number {
  const key = p === "handoff" ? "recreate" : p;
  const i = STEPS.findIndex((s) => s.key === key);
  return i < 0 ? 0 : i;
}

/**
 * `enabled`, but only once it has held for `delayMs`.
 *
 * The cutover poll must not fire on the first render: `recovering` is true
 * from mount for any real run, so re-opening this pane after an update already
 * landed would probe a control plane that *already* reports the target and
 * reload straight back into the same state. The lead-in gives
 * `useUpdateState` time to answer `succeeded` and disarm the poll first.
 */
function useArmedAfter(enabled: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const id = setTimeout(() => setElapsed(true), delayMs);
    // Rearm from zero if this ever re-enables — a second wait deserves a
    // second lead-in, not the leftover `true` from the first.
    return () => {
      clearTimeout(id);
      setElapsed(false);
    };
  }, [enabled, delayMs]);
  // Derived, not stored: disabling disarms without a state write.
  return enabled && elapsed;
}

/** Poll the control plane until the new container reports the target version,
 *  then reload onto the updated dashboard. Real-cutover recovery only. */
export function useCutoverRecovery(target: string, enabled: boolean): void {
  const armed = useArmedAfter(enabled, 6000);

  const health = useQuery({
    queryKey: ["cutover-health", target],
    queryFn: async ({ signal }) => {
      // Unauthenticated and outside oRPC on purpose: /rpc needs a session the
      // restarting server can't validate, and we want the version the *new*
      // binary reports, not a cached read model.
      const res = await fetch(`${env.VITE_SERVER_URL}/api/health`, { cache: "no-store", signal });
      if (!res.ok) throw new Error(`health ${res.status}`);
      return (await res.json()) as { version?: string };
    },
    enabled: armed,
    // Across a cutover the control plane is *expected* to be unreachable, so a
    // failed probe is the normal path, not an error: the interval is the retry
    // (no backoff), and the global queryCache toast must stay quiet or the
    // operator gets "Failed to fetch" every 3s while they wait.
    retry: false,
    meta: { suppressErrorToast: true },
    refetchInterval: 3000,
    // An operator who switches tabs mid-update still gets reloaded — React
    // Query otherwise pauses the interval whenever the document is unfocused.
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
  });

  const arrived = armed && health.data?.version === target;
  useEffect(() => {
    // Reloading is terminal, so it must not survive an unmount: closing the
    // pane while a probe is in flight has to abandon the reload, not perform
    // it a moment later.
    if (arrived) window.location.reload();
  }, [arrived]);
}

export function toLogLine(e: {
  level: "info" | "success" | "error";
  message: string;
  ts: string;
}): Omit<LogLine, "id"> {
  return { stream: e.level === "error" ? "stderr" : "system", line: e.message, ts: e.ts };
}

export function toErrorLine(err: unknown): Omit<LogLine, "id"> {
  return {
    stream: "stderr",
    line: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
    ts: new Date().toISOString(),
  };
}

export interface Outcome {
  failed: boolean;
  dryDone: boolean;
  realDone: boolean;
  done: boolean;
  terminal: boolean;
  /** Whether the /health cutover poll should run. */
  recovering: boolean;
}

export function deriveOutcome(
  dryRun: boolean,
  streamEnded: boolean,
  runStatus?: RunStatus,
): Outcome {
  const failed = runStatus === "failed";
  const dryDone = dryRun && streamEnded && !failed;
  const realDone = !dryRun && runStatus === "succeeded";
  const done = dryDone || realDone;
  return {
    failed,
    dryDone,
    realDone,
    done,
    terminal: done || failed,
    recovering: !dryRun && !failed && !realDone,
  };
}

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
  return (
    <div
      ref={scrollRef}
      className="h-[320px] overflow-auto rounded-md border bg-terminal p-2.5 font-mono text-[11px] leading-relaxed text-terminal-foreground/85"
    >
      {lines.length === 0 ? (
        <div className="text-muted-foreground/60">Starting…</div>
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
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }
  if (outcome.realDone) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-success">Update to {target} complete.</span>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
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
