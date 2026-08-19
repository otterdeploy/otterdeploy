/**
 * Derivation and hooks behind the self-update progress view, phase ordering,
 * the cutover-recovery poll, log-line shaping, and the terminal outcome.
 *
 * Split from ./update-progress-parts so that file is presentational only. The
 * two are edited for different reasons: this changes when the update protocol
 * does, the components change when the layout does.
 */

import { useEffect, useState } from "react";

/**
 * Presentational + pure helpers for {@link UpdateProgress}. Split out so the
 * pane component itself stays under the line/complexity budget.
 */
import { env } from "@otterdeploy/env/web";
import { useQuery } from "@tanstack/react-query";

import type { LogLine } from "@/features/logs/components/log-viewer";

import type { useCancelUpdate } from "../data/use-update-status";

export type UpdatePhase = "validate" | "pull" | "migrate" | "recreate" | "handoff" | "done";
export type RunStatus = "idle" | "running" | "succeeded" | "failed";

export type CancelMutation = ReturnType<typeof useCancelUpdate>;

/** Visible steps in order. `handoff` folds into `recreate` for display: it's
 *  the same "restarting the control plane" beat. Labels are i18n keys,
 *  resolved at render time by the stepper. */
export const STEPS = [
  { key: "validate", labelKey: "updates.stepValidate" },
  { key: "pull", labelKey: "updates.stepPull" },
  { key: "migrate", labelKey: "updates.stepMigrate" },
  { key: "recreate", labelKey: "updates.stepRecreate" },
  { key: "done", labelKey: "updates.stepDone" },
] as const;

export function phaseIndex(p: UpdatePhase): number {
  const key = p === "handoff" ? "recreate" : p;
  const i = STEPS.findIndex((s) => s.key === key);
  return i < 0 ? 0 : i;
}

/** One sentence of state per phase, the pane's headline. `handoff` and `done`
 *  fold into recreate: by then the cutover pane or the outcome owns the room. */
export const PHASE_HEADLINE_KEYS = {
  validate: "updates.phaseValidate",
  pull: "updates.phasePull",
  migrate: "updates.phaseMigrate",
  recreate: "updates.phaseRecreate",
  handoff: "updates.phaseRecreate",
  done: "updates.phaseRecreate",
} as const;

/** Reset stays hidden until a run has plausibly hung: it exists for the rare
 *  stuck helper, and offering it earlier invites panic-clicks during every
 *  normal wait (the flaw the old footer had). Pull can legitimately take a
 *  couple of minutes; the cutover normally answers within seconds. */
export const STUCK_RUN_MS = 180_000;
export const STUCK_CUTOVER_MS = 90_000;

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
    // Rearm from zero if this ever re-enables: a second wait deserves a
    // second lead-in, not the leftover `true` from the first.
    return () => {
      clearTimeout(id);
      setElapsed(false);
    };
  }, [enabled, delayMs]);
  // Derived, not stored: disabling disarms without a state write.
  return enabled && elapsed;
}

/**
 * Latches true once `pending` has been observed, and STAYS true after it goes
 * false again, which is the whole point: the caller needs to distinguish "this
 * run settled while I watched it" from "this run was already settled when I
 * mounted", and by the time it can tell, `pending` is false in both cases.
 */
function useSeen(pending: boolean): boolean {
  const [seen, setSeen] = useState(false);
  // Latch during render (guarded prev-value compare) rather than in an
  // effect: same adjust-in-render pattern as the sort/follow latch in
  // use-logs-table, and it avoids the extra cascading render an effect costs.
  if (pending && !seen) setSeen(true);
  return pending || seen;
}

/**
 * Has the new control plane arrived, i.e. should this page reload onto it?
 *
 * Two independent signals, because the /health probe usually LOSES the race
 * that matters: `useUpdateState` polls every 2s while the probe waits out a 6s
 * lead-in first. When updateState wins, the run reads `succeeded`, `recovering`
 * goes false, the probe disarms, and the reload the operator was promised
 * never fires, leaving `Done` to drop them back onto the OLD bundle.
 *
 * So a settled `succeeded` counts as arrival in its own right. It is sound
 * evidence: the only writer is finalizeHandedOffRun() on the NEW server's boot
 * (the old process can't reach it, its own currentVersion() never equals the
 * target), so `realDone` on a real run means the cutover landed.
 *
 * `sawPending` gates that second signal on having actually observed the run in
 * flight, so a pane mounted onto an already-settled run can't reload into
 * itself forever.
 */
function cutoverArrived(args: {
  realDone: boolean;
  sawPending: boolean;
  armed: boolean;
  healthVersion: string | undefined;
  target: string;
}): boolean {
  const settled = args.realDone && args.sawPending;
  return settled || (args.armed && args.healthVersion === args.target);
}

/** Poll the control plane until the new container reports the target version,
 *  then reload onto the updated dashboard. Real-cutover recovery only.
 *  Returns the number of probes attempted so far, so the cutover pane can show
 *  the wait as visible work instead of dead air. */
export function useCutoverRecovery(target: string, outcome: Outcome): number {
  const armed = useArmedAfter(outcome.recovering, 6000);
  const sawPending = useSeen(outcome.recovering);

  const health = useQuery({
    queryKey: ["cutover-health", target],
    queryFn: async ({ signal }) => {
      // Unauthenticated and outside oRPC on purpose: /rpc needs a session the
      // restarting server can't validate, and we want the version the *new*
      // binary reports, not a cached read model.
      const res = await fetch(`${env.VITE_SERVER_URL}/api/health`, { cache: "no-store", signal });
      if (!res.ok) throw new Error(`health ${res.status}`);
      const body: unknown = await res.json();
      const version =
        body && typeof body === "object" && "version" in body && typeof body.version === "string"
          ? body.version
          : undefined;
      return { version };
    },
    enabled: armed,
    // Across a cutover the control plane is *expected* to be unreachable, so a
    // failed probe is the normal path, not an error: the interval is the retry
    // (no backoff), and the global queryCache toast must stay quiet or the
    // operator gets "Failed to fetch" every 3s while they wait.
    retry: false,
    meta: { suppressErrorToast: true },
    refetchInterval: 3000,
    // An operator who switches tabs mid-update still gets reloaded. React
    // Query otherwise pauses the interval whenever the document is unfocused.
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
  });

  const arrived = cutoverArrived({
    realDone: outcome.realDone,
    sawPending,
    armed,
    healthVersion: health.data?.version,
    target,
  });
  useEffect(() => {
    // Reloading is terminal, so it must not survive an unmount: closing the
    // pane while a probe is in flight has to abandon the reload, not perform
    // it a moment later.
    if (arrived) window.location.reload();
  }, [arrived]);

  // Every failed fetch (the expected connection-refused kind) bumps
  // errorUpdateCount; a successful probe is the arrival itself, so it counts
  // as at most one more.
  return health.errorUpdateCount + (health.isSuccess ? 1 : 0);
}

export function toLogLine(e: {
  level: "info" | "success" | "error";
  message: string;
  ts: string;
}): Omit<LogLine, "id"> {
  return {
    stream: e.level === "error" ? "stderr" : "system",
    line: e.message,
    // Time-of-day only (UTC, like every other log surface): an update run
    // spans minutes, so repeating the full date on every row is noise in a
    // dialog-width pane.
    ts: e.ts.slice(11, 19),
  };
}

export function toErrorLine(err: unknown): Omit<LogLine, "id"> {
  return {
    stream: "stderr",
    line: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
    // Same time-of-day format as toLogLine: a full ISO date on one red row in
    // a pane of HH:MM:SS lines reads as a different kind of event.
    ts: new Date().toISOString().slice(11, 19),
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

export function deriveOutcome(dryRun: boolean, runStatus?: RunStatus): Outcome {
  const failed = runStatus === "failed";
  // Both flavours of done come from the polled run state, not the stream:
  // the stream ending only means "disconnected" (the tail hook reconnects),
  // so it was never a sound completion signal even for a dry run.
  const dryDone = dryRun && runStatus === "succeeded";
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
