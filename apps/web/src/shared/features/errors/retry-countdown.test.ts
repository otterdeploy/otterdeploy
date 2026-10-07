import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RETRY_COUNTDOWN_TICK_MS, startRetryCountdown } from "./retry-countdown";

let clock = 0;
const now = () => clock;

function advance(ms: number) {
  clock += ms;
  vi.advanceTimersByTime(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the rate-limited notice's countdown", () => {
  it("ticks once a second down to zero, then retries exactly once", () => {
    const ticks: number[] = [];
    const onDone = vi.fn();
    startRetryCountdown({ deadline: 3_000, onTick: (left) => ticks.push(left), onDone, now });
    for (let i = 0; i < 5; i++) advance(RETRY_COUNTDOWN_TICK_MS);
    expect(ticks).toEqual([2, 1, 0]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reads the clock, so skipped ticks (a throttled tab) still land on the deadline", () => {
    const ticks: number[] = [];
    const onDone = vi.fn();
    startRetryCountdown({ deadline: 10_000, onTick: (left) => ticks.push(left), onDone, now });
    clock += 8_500; // the tab slept through eight ticks
    advance(RETRY_COUNTDOWN_TICK_MS);
    expect(ticks).toEqual([1]);
    advance(RETRY_COUNTDOWN_TICK_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stops without retrying when the notice goes away first", () => {
    const onDone = vi.fn();
    const stop = startRetryCountdown({ deadline: 2_000, onTick: () => {}, onDone, now });
    stop();
    advance(5 * RETRY_COUNTDOWN_TICK_MS);
    expect(onDone).not.toHaveBeenCalled();
  });
});
