/**
 * Derivation and hooks behind the self-update progress view — phase ordering,
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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { LogLineRow, type LogLine } from "@/features/logs/components/log-viewer";
import { Button } from "@/shared/components/ui/button";

import type { useCancelUpdate } from "../data/use-update-status";

export type UpdatePhase = "validate" | "pull" | "migrate" | "recreate" | "handoff" | "done";
export type RunStatus = "idle" | "running" | "succeeded" | "failed";

export type CancelMutation = ReturnType<typeof useCancelUpdate>;

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

/**
 * Latches true once `pending` has been observed, and STAYS true after it goes
 * false again — which is the whole point: the caller needs to distinguish "this
 * run settled while I watched it" from "this run was already settled when I
 * mounted", and by the time it can tell, `pending` is false in both cases.
 */
function useSeen(pending: boolean): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (pending) setSeen(true);
  }, [pending]);
  return seen;
}

/**
 * Has the new control plane arrived, i.e. should this page reload onto it?
 *
 * Two independent signals, because the /health probe usually LOSES the race
 * that matters: `useUpdateState` polls every 2s while the probe waits out a 6s
 * lead-in first. When updateState wins, the run reads `succeeded`, `recovering`
 * goes false, the probe disarms — and the reload the operator was promised
 * never fires, leaving `Done` to drop them back onto the OLD bundle.
 *
 * So a settled `succeeded` counts as arrival in its own right. It is sound
 * evidence: the only writer is finalizeHandedOffRun() on the NEW server's boot
 * (the old process can't reach it — its own currentVersion() never equals the
 * target), so `realDone` on a real run means the cutover landed.
 *
 * `sawPending` gates that second signal on having actually observed the run in
 * flight, so a pane mounted onto an already-settled run can't reload into
 * itself forever.
 */
export function cutoverArrived(args: {
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
 *  then reload onto the updated dashboard. Real-cutover recovery only. */
export function useCutoverRecovery(target: string, outcome: Outcome): void {
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
