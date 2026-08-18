import { useRef, useState } from "react";

/**
 * Live progress pane for an in-flight platform update. Streams the server's
 * `system.progress` event-iterator into the log pane, renders the update
 * phases as a stepper, and offers a reset for a stuck run. On a real cutover
 * the server is replaced mid-update, so this also polls /api/health until the
 * NEW container answers with the target version, then hard-reloads, or, if
 * the persisted run turns `failed` (the helper died without cutting over),
 * stops waiting and surfaces the error. Presentational pieces live in
 * ./update-progress-parts to keep this file within budget.
 */
import { type LogLine } from "@/features/logs/components/log-viewer";
import { useLogStream } from "@/features/logs/data/use-log-stream";
import { orpc } from "@/shared/server/orpc";

import { useCancelUpdate, useUpdateState } from "../data/use-update-status";
import {
  STEPS,
  deriveOutcome,
  phaseIndex,
  toErrorLine,
  toLogLine,
  useCutoverRecovery,
  type UpdatePhase,
} from "./update-progress-model";
import { LogPane, PhaseStepper, UpdateOutcome } from "./update-progress-parts";

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
    // effect, so the setState is fine and keeps the stepper current.
    map: (e, id): LogLine => {
      setPhase(e.phase);
      return { id, ...toLogLine(e) };
    },
    onError: (err, id): LogLine => ({ id, ...toErrorLine(err) }),
    key: `${target}|${dryRun}`,
  });

  const outcome = deriveOutcome(dryRun, runState.data?.status);
  useCutoverRecovery(target, outcome);

  const current = outcome.done ? STEPS.length - 1 : phaseIndex(phase);

  return (
    <div className="flex flex-col gap-3">
      <PhaseStepper current={current} failed={outcome.failed} />
      <LogPane lines={lines} />
      <UpdateOutcome
        outcome={outcome}
        target={target}
        dryRun={dryRun}
        onDone={onDone}
        cancel={cancel}
        error={runState.data?.error ?? null}
        handedOff={runState.data?.handedOff ?? false}
      />
    </div>
  );
}
