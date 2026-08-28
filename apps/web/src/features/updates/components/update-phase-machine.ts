/**
 * The phase bar's own clock: a forward-only walk over the visible steps.
 *
 * The server's phase stream is not a safe direct input to the animation. It can
 * jump (a fast run reports `validate` then `recreate` two ticks later), it can
 * arrive out of order across a stream reconnect, and `done` sets the target
 * past every remaining step at once. Bound straight to the bar, that produced
 * exactly the three faults this machine exists to remove: a segment still
 * creeping while its successor had already started, several segments sealing
 * green in the same frame, and — after a reconnect replayed an older phase — a
 * bar that walked backwards.
 *
 * So the bar tracks a `cursor` of its own that only ever moves forward, one
 * segment at a time. A target ahead of the cursor is latched as a `goal`; the
 * cursor closes the gap by sealing the segment it is on (`SEAL_MS`), and only
 * once that seal has finished does the next segment become live. A target
 * BEHIND the cursor is ignored outright — there is no transition out of a step
 * that has already been shown as finished.
 *
 * Exactly one segment is ever in motion, and the sequence you see is the
 * sequence the run took.
 */
import { useEffect, useState } from "react";

/** What a single segment of the bar is doing right now.
 *  - `idle`    — not reached yet, empty track.
 *  - `active`  — the live phase: creeping, never arriving (see CREEP_TO).
 *  - `sealing` — filling to full and turning success-coloured; the one beat
 *                during which the next segment must stay idle.
 *  - `done`    — settled full, no motion.
 *  - `failed`  — the run died here; fills destructive and the walk stops. */
export type SegmentState = "idle" | "active" | "sealing" | "done" | "failed";

/** How long a segment takes to close from wherever its creep had reached. */
export const SEAL_MS = 420;

/** The machine's step interval: the walk advances one segment per seal, so a
 *  five-step jump reads as five beats rather than one simultaneous flash. The
 *  margin over `SEAL_MS` lets the seal's last frame land before the segment
 *  flips to its static `done` style, which would otherwise clip the tail. */
const STEP_MS = SEAL_MS + 80;

/**
 * The creep. An update phase has no known duration — the server reports which
 * phase it is in, never how far through it is — so the curve is asymptotic: it
 * covers most of the segment early, then keeps inching without arriving.
 * `CREEP_TO` is the honest part. A segment can never fill itself; only a real
 * phase change (the seal) takes it to full, so the bar cannot claim a step
 * finished before the run said so.
 *
 * A CSS transition rather than a keyframe animation on purpose: the seal
 * interrupts the creep mid-flight, and an interrupted transition resumes from
 * the value currently on screen. The old keyframe version snapped back to its
 * base scale on the way out, which is what made the hand-off visibly jump.
 */
const CREEP_MS = 45_000;
const CREEP_TO = 0.92;
/** Front-loaded: a fast phase still reads as filling, a slow one (pull can run
 *  minutes) keeps inching instead of parking. */
const CREEP_EASE = "cubic-bezier(0, 0.55, 0.15, 1)";

export interface PhaseWalk {
  /** Per-step display state, indexed like the steps themselves. */
  states: SegmentState[];
  /** The step the bar is on. Labels follow this, not the raw phase, so the
   *  caption never highlights a step whose segment hasn't lit yet. */
  cursor: number;
}

/** Pure projection of the walk onto per-segment states. Split from the hook so
 *  the ordering rules can be tested without a renderer. */
export function walkStates(args: {
  cursor: number;
  goal: number;
  failed: boolean;
  count: number;
}): SegmentState[] {
  const { cursor, goal, failed, count } = args;
  const sealing = !failed && cursor < goal;
  return Array.from({ length: count }, (_, i) => {
    if (i < cursor) return "done";
    if (i > cursor) return "idle";
    if (failed) return "failed";
    return sealing ? "sealing" : "active";
  });
}

/**
 * Drive the walk from the run's current step index.
 *
 * `target` is where the run says it is (`phaseIndex`, or `count` once the run
 * has settled); the machine decides when the bar gets there. Mounting onto an
 * already-settled run starts AT the target rather than replaying the whole
 * sequence — the theatre is for progress being made, not for history.
 */
export function usePhaseWalk(target: number, failed: boolean, count: number): PhaseWalk {
  const start = Math.min(Math.max(target, 0), count);
  const [cursor, setCursor] = useState(start);
  const [goal, setGoal] = useState(start);

  // Forward-only latch, adjusted in render (same pattern as `useSeen` in
  // ./update-progress-model): a target behind the goal is a replay or a
  // reconnect, and the bar has no reverse gear.
  const next = Math.min(target, count);
  if (next > goal) setGoal(next);
  const goalNow = Math.max(goal, next);

  // A failure is not a beat to walk through. If the run died several steps
  // ahead of the cursor, the bar snaps to the step it died in rather than
  // sealing its way there and marking the wrong one red in the meantime.
  if (failed && cursor < goalNow) setCursor(goalNow);
  const cursorNow = failed ? Math.max(cursor, goalNow) : cursor;

  const sealing = !failed && cursorNow < goalNow;
  useEffect(() => {
    if (!sealing) return;
    // One seal per tick, and `cursorNow` is a dep, so closing a multi-step gap
    // re-arms this and walks the rest one segment at a time.
    const id = setTimeout(() => setCursor((c) => c + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [sealing, cursorNow]);

  return {
    states: walkStates({ cursor: cursorNow, goal: goalNow, failed, count }),
    cursor: cursorNow,
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The transform + transition a segment should be wearing for a given state.
 *
 * Applied imperatively (see `PhaseSegment`) so the creep survives the parent's
 * re-renders — the log stream re-renders this pane on every line, and a
 * declarative transform would restart the transition each time.
 *
 * Under `prefers-reduced-motion` every state is a still frame: the live segment
 * parks at a static half fill instead of creeping, and seals land instantly.
 * The state stays legible, it just stops moving (same contract as `.mark-arc`).
 */
export function segmentStyle(state: SegmentState): { transform: string; transition: string } {
  const reduced = prefersReducedMotion();
  const still = (transform: string) => ({ transform, transition: "none" });
  const moving = (transform: string, ms: number, ease: string) => ({
    transform,
    // Colour rides the seal so warning becomes success over the same beat
    // rather than flipping a frame before the fill lands.
    transition: `transform ${ms}ms ${ease}, background-color ${SEAL_MS}ms ease-out`,
  });
  switch (state) {
    case "idle":
      return still("scaleX(0)");
    case "active":
      return reduced ? still("scaleX(0.5)") : moving(`scaleX(${CREEP_TO})`, CREEP_MS, CREEP_EASE);
    case "sealing":
    case "failed":
      return reduced ? still("scaleX(1)") : moving("scaleX(1)", SEAL_MS, "ease-out");
    case "done":
      return still("scaleX(1)");
  }
}
