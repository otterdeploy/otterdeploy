import { useRef, useState } from "react";

/**
 * Live progress pane for an in-flight platform update, laid out as B1 "Quiet
 * Progress" (see the update-flow exploration artifact): a phase headline and
 * segmented bar lead, the log is a heartbeat line plus a disclosure, and the
 * cutover renders as its own designed pane with a probe counter. Streams the
 * server's `system.progress` event-iterator, and on a real cutover polls
 * /api/health until the NEW container answers with the target version, then
 * hard-reloads. Presentational pieces live in ./update-progress-parts.
 */
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { type LogLine } from "@/features/logs/components/log-viewer";
import { useLogStream } from "@/features/logs/data/use-log-stream";
import { orpc } from "@/shared/server/orpc";

import { useCancelUpdate, useUpdateState } from "../data/use-update-status";
import { CutoverPane } from "./update-cutover-pane";
import { SegmentedPhases } from "./update-phase-bar";
import { useElapsedSince } from "./update-progress-clock";
import {
  STEPS,
  STUCK_CUTOVER_MS,
  STUCK_RUN_MS,
  deriveOutcome,
  phaseIndex,
  toErrorLine,
  toLogLine,
  useCutoverRecovery,
  type Outcome,
  type UpdatePhase,
} from "./update-progress-model";
import { HeartbeatRow, LogPane, UpdateFooter, UpdateHeadline } from "./update-progress-parts";

interface ProgressEvent {
  seq: number;
  ts: string;
  level: "info" | "success" | "error";
  phase: UpdatePhase;
  message: string;
}

/**
 * Yield only events newer than the resume point, advancing it as they flow.
 *
 * `system.progress` replays a run's whole history to every subscriber, and a
 * real cutover forces reconnects (the server restarts under the stream), so
 * without this each reconnect appended the full log again — the wall of
 * duplicated lines this pane used to show. The server-side `afterSeq` skips
 * the replay at the source; this filter is the belt to that suspender (an
 * older server that ignores the input still gets deduplicated here).
 */
async function* afterSeen(
  stream: AsyncIterable<ProgressEvent>,
  lastSeqRef: { current: number },
): AsyncGenerator<ProgressEvent> {
  for await (const event of stream) {
    if (event.seq <= lastSeqRef.current) continue;
    lastSeqRef.current = event.seq;
    yield event;
  }
}

export function UpdateProgress({
  target,
  dryRun,
  onDone,
}: {
  target: string;
  dryRun: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<UpdatePhase>("validate");
  const runState = useUpdateState();
  const cancel = useCancelUpdate();
  const lastSeqRef = useRef(0);

  const { lines } = useLogStream({
    // The hook owns reconnection (NOT the oRPC retry plugin: a plugin retry
    // transparently re-invokes the call with the same input, replaying the
    // full history as duplicate lines). `initial` restarts the resume point;
    // reconnects pass the last seq so the server resumes after it.
    open: async (signal, initial) => {
      if (initial) lastSeqRef.current = 0;
      const stream = await orpc.system.progress.call(
        { afterSeq: lastSeqRef.current || undefined },
        { signal },
      );
      return afterSeen(stream, lastSeqRef);
    },
    // Track the phase as lines flow. This runs in the stream loop, not an
    // effect, so the setState is fine and keeps the headline current.
    map: (e, id): LogLine => {
      setPhase(e.phase);
      return { id, ...toLogLine(e) };
    },
    onError: (err, id): LogLine => ({ id, ...toErrorLine(err) }),
    key: `${target}|${dryRun}`,
  });

  const outcome = deriveOutcome(dryRun, runState.data?.status);
  const probes = useCutoverRecovery(target, outcome);
  const handedOff = runState.data?.handedOff ?? false;
  const inCutover = !dryRun && handedOff && !outcome.terminal;

  const runMs = useElapsedSince(!outcome.terminal);
  const cutoverMs = useElapsedSince(inCutover);

  const handleReset = () =>
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

  if (inCutover) {
    return (
      <CutoverPane
        target={target}
        probes={probes}
        waitedMs={cutoverMs}
        stuck={cutoverMs > STUCK_CUTOVER_MS}
        resetPending={cancel.isPending}
        onReset={handleReset}
      />
    );
  }

  return (
    <ProgressBody
      outcome={outcome}
      phase={phase}
      dryRun={dryRun}
      target={target}
      error={runState.data?.error ?? null}
      lines={lines}
      runMs={runMs}
      onDone={onDone}
      resetPending={cancel.isPending}
      onReset={handleReset}
    />
  );
}

/** Everything below the dialog header outside the cutover: headline, bar,
 *  heartbeat + disclosure, terminal footer. Owns the disclosure state so the
 *  streaming component above stays within the complexity budget. */
function ProgressBody({
  outcome,
  phase,
  dryRun,
  target,
  error,
  lines,
  runMs,
  onDone,
  resetPending,
  onReset,
}: {
  outcome: Outcome;
  phase: UpdatePhase;
  dryRun: boolean;
  target: string;
  error: string | null;
  lines: LogLine[];
  runMs: number;
  onDone: () => void;
  resetPending: boolean;
  onReset: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [failedSeen, setFailedSeen] = useState(false);

  // Failure must surface the evidence: force the disclosure open exactly once
  // per failure (the operator can still close it again). Adjust-in-render
  // latch, same pattern as useSeen in ./update-progress-model.
  if (outcome.failed && !failedSeen) {
    setFailedSeen(true);
    if (!logOpen) setLogOpen(true);
  }

  const current = outcome.done ? STEPS.length : phaseIndex(phase);
  return (
    <div className="flex flex-col gap-3.5">
      <UpdateHeadline
        outcome={outcome}
        phase={phase}
        dryRun={dryRun}
        target={target}
        error={error}
      />
      <SegmentedPhases current={current} failed={outcome.failed} />
      {!outcome.failed && (
        <HeartbeatRow
          line={lines.at(-1) ?? null}
          clockMs={runMs}
          open={logOpen}
          onToggle={() => setLogOpen((v) => !v)}
        />
      )}
      {(logOpen || outcome.failed) && <LogPane lines={lines} />}
      <UpdateFooter
        outcome={outcome}
        onDone={onDone}
        showReset={!outcome.terminal && runMs > STUCK_RUN_MS}
        resetPending={resetPending}
        onReset={onReset}
      />
    </div>
  );
}
