/**
 * The update stepper's phase bar: one segment per visible step, driven by the
 * forward-only walk in ./update-phase-machine. Its own file because the motion
 * here is imperative (see PhaseSegment) and has nothing to do with the rest of
 * the pane's presentational pieces in ./update-progress-parts.
 */
import { useEffect, useRef } from "react";

import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

import { segmentStyle, usePhaseWalk, type SegmentState } from "./update-phase-machine";
import { STEPS } from "./update-progress-model";

/** The hairline progress bar: one segment per visible step, labels beneath.
 *  Done phases read success, the live one FILLS in warning, a failure marks the
 *  phase it died in.
 *
 *  Each segment is a track with a fill inside it rather than a block that
 *  changes colour, and the sequence is owned by the forward-only walk in
 *  ./update-phase-machine rather than by the raw phase: at most one segment is
 *  in motion at a time, a segment seals to full before its successor lights up,
 *  and the bar never runs backwards when a stream reconnect replays an older
 *  phase. `current` is where the RUN is; the machine decides when the bar gets
 *  there.
 *
 *  The old version bound the raw phase straight to the classes, which meant a
 *  segment could still be creeping while the next had already gone live, and a
 *  multi-step jump sealed several segments in the same frame. */
export function SegmentedPhases({ current, failed }: { current: number; failed: boolean }) {
  const { t } = useTranslation();
  const walk = usePhaseWalk(current, failed, STEPS.length);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1" role="presentation">
        {STEPS.map((step, i) => (
          <span
            key={step.key}
            className="h-0.75 flex-1 overflow-hidden rounded-full bg-foreground/10"
          >
            <PhaseSegment state={walk.states[i] ?? "idle"} />
          </span>
        ))}
      </div>
      <ol className="flex gap-1 text-[10px]">
        {STEPS.map((step, i) => (
          <li
            key={step.key}
            className={cn(
              "flex-1 text-muted-foreground/50",
              // Follows the bar's cursor, not the run: the label lights with
              // its own segment, never a beat ahead of it.
              i === walk.cursor && (failed ? "text-destructive" : "text-foreground/80"),
            )}
          >
            {t(step.labelKey)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Colour is state, motion is `segmentStyle`. `idle` wears the live colour so
 *  going live is a pure fill with no colour flip; only the seal changes hue. */
function segmentTone(state: SegmentState): string {
  switch (state) {
    case "failed":
      return "bg-destructive";
    case "sealing":
    case "done":
      return "bg-success";
    default:
      return "bg-warning";
  }
}

/**
 * One segment's fill.
 *
 * The transform is written to the node rather than rendered as a prop: this
 * pane re-renders on every streamed log line, and a declarative transform would
 * restart the 45s creep each time. Writing it only when the STATE changes means
 * the creep runs uninterrupted, and the seal interrupts it mid-flight from
 * whatever value is on screen — the property of transitions the old keyframe
 * animation could not give us.
 */
function PhaseSegment({ state }: { state: SegmentState }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { transform, transition } = segmentStyle(state);
    // Transition first: it must already be in place when the transform lands,
    // or the browser applies the new value with the PREVIOUS state's curve.
    el.style.transition = transition;
    el.style.transform = transform;
  }, [state]);
  // Mounts empty (the class), so the first creep interpolates from zero rather
  // than snapping to its target on the first frame.
  return (
    <span
      ref={ref}
      className={cn("block h-full origin-left scale-x-0 rounded-full", segmentTone(state))}
    />
  );
}
