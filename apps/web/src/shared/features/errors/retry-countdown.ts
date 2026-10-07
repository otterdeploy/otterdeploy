/**
 * The ticking half of the "slow down" notice (./rate-limited.tsx), apart from
 * React so it can be driven with fake timers: one tick a second reports the
 * whole seconds left until `deadline`, and the tick that reaches zero stops the
 * clock and retries.
 */

import { Temporal } from "@otterdeploy/shared/temporal";

/** One tick a second: the countdown shows whole seconds. */
export const RETRY_COUNTDOWN_TICK_MS = 1_000;

export function epochMs(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

/**
 * Count down to `deadline` (epoch ms). Measured against the clock on every
 * tick rather than decremented, so a throttled background tab that skips
 * ticks still reports how long is actually left. Returns the stop function.
 */
export function startRetryCountdown({
  deadline,
  onTick,
  onDone,
  now = epochMs,
}: {
  deadline: number;
  onTick: (secondsLeft: number) => void;
  onDone: () => void;
  now?: () => number;
}): () => void {
  const timer = setInterval(() => {
    const left = Math.max(0, Math.ceil((deadline - now()) / 1_000));
    onTick(left);
    if (left === 0) {
      clearInterval(timer);
      onDone();
    }
  }, RETRY_COUNTDOWN_TICK_MS);
  return () => clearInterval(timer);
}
