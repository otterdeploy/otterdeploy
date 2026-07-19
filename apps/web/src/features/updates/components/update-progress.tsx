import { useEffect, useRef, useState } from "react";

/**
 * Live progress pane for an in-flight platform update. Streams the server's
 * `system.progress` event-iterator into the shared log viewer, renders the
 * update phases as a stepper, and offers a reset for a stuck run. On a real
 * cutover the server is replaced mid-update, so this also polls /api/health
 * until the NEW container answers with the target version, then hard-reloads —
 * or, if the persisted run turns `failed` (the helper died without cutting
 * over), stops waiting and surfaces the error. Presentational pieces live in
 * ./update-progress-parts to keep this file within budget.
 */
import { type LogLine } from "@/features/logs/components/log-viewer";
import { useLogStream } from "@/features/logs/data/use-log-stream";
import { orpc } from "@/shared/server/orpc";

import { useCancelUpdate, useUpdateState } from "../data/use-update-status";
import {
  LogPane,
  PhaseStepper,
  ProgressHeader,
  STEPS,
  UpdateOutcome,
  deriveOutcome,
  phaseIndex,
  toErrorLine,
  toLogLine,
  useCutoverRecovery,
  type UpdatePhase,
} from "./update-progress-parts";

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

  const { lines, status: streamStatus } = useLogStream({
    open: (signal) =>
      orpc.system.progress.call(
        {},
        // Real cutover: retry so the stream reconnects across the restart.
        // Dry-run completes in one pass, so no retry.
        { signal, context: { retry: dryRun ? 0 : Number.POSITIVE_INFINITY } },
      ),
    // Track the phase as lines flow — this runs in the stream loop, not an
    // effect, so the setState is fine and keeps the stepper current.
    map: (e, id): LogLine => {
      setPhase(e.phase);
      return { id, ...toLogLine(e) };
    },
    onError: (err, id): LogLine => ({ id, ...toErrorLine(err) }),
    deps: [target, dryRun],
  });

  const outcome = deriveOutcome(dryRun, streamStatus === "ended", runState.data?.status);
  useCutoverRecovery(target, outcome.recovering);

  // Follow the tail: stick to the bottom as lines stream in.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const current = outcome.done ? STEPS.length - 1 : phaseIndex(phase);

  return (
    <div className="flex flex-col gap-2">
      <ProgressHeader dryRun={dryRun} target={target} showActivity={!outcome.terminal} />
      <PhaseStepper current={current} failed={outcome.failed} />
      <LogPane lines={lines} scrollRef={scrollRef} />
      <UpdateOutcome
        outcome={outcome}
        target={target}
        dryRun={dryRun}
        onDone={onDone}
        cancel={cancel}
        error={runState.data?.error ?? null}
      />
    </div>
  );
}
