/**
 * Live versus replay admission. Live rounds are current state and are never
 * refused here. Replay (backlog after a partition or restart) is history and
 * yields: it is refused, with a retry hint, while the rollup worker lags past
 * the live lateness allowance, while live batches are queueing, or at the last
 * disk-pressure level. A refused replay batch is retried by the node; nothing
 * is lost, it just waits.
 */
import { LIVE_LATENESS_MS } from "./model";

export interface LaneState {
  /** Disk-pressure level from retention (0 none … 3 last). */
  pressureLevel: 0 | 1 | 2 | 3;
  /** Age of the oldest pending rebuild obligation. */
  rollupLagMs: number;
  /** How long the oldest waiting live batch has waited (0 when none waits). */
  liveQueueAgeMs: number;
  /** Whether any live batch is waiting. */
  liveWaiting: boolean;
}

export interface LanePolicy {
  replayLagLimitMs: number;
  /**
   * Refuse replay once a live batch has waited this long. 0 refuses replay
   * whenever any live batch waits; a positive value sheds replay less coarsely.
   */
  liveQueueAgeLimitMs: number;
}

const DEFAULT_LANE_POLICY: LanePolicy = {
  replayLagLimitMs: LIVE_LATENESS_MS,
  liveQueueAgeLimitMs: 0,
};

export type LaneDecision =
  | { admit: true }
  | { admit: false; reason: "disk_pressure" | "rollup_lag" | "live_busy"; retryAfterMs: number };

export function admitBatch(
  live: boolean,
  state: LaneState,
  policy: LanePolicy = DEFAULT_LANE_POLICY,
): LaneDecision {
  if (live) return { admit: true };
  const refuse = (reason: "disk_pressure" | "rollup_lag" | "live_busy") =>
    ({ admit: false, reason, retryAfterMs: 5_000 }) as const;
  if (state.pressureLevel >= 3) return refuse("disk_pressure");
  if (state.rollupLagMs > policy.replayLagLimitMs) return refuse("rollup_lag");
  if (state.liveWaiting && state.liveQueueAgeMs >= policy.liveQueueAgeLimitMs) {
    return refuse("live_busy");
  }
  return { admit: true };
}
