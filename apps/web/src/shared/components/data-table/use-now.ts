/**
 * One clock for every relative timestamp on screen.
 *
 * "3 minutes ago" is only true at the moment it renders. A table left open —
 * which is what an operator does with a feed — quietly fills up with
 * timestamps that are wrong by however long they have been sitting there, and
 * a table that says "just now" about something from an hour ago is lying about
 * the system's state.
 *
 * One module-level interval serves every cell, and it only runs while
 * something is subscribed. Read through `useSyncExternalStore` so the value is
 * shared rather than re-derived per component, and so a cell re-renders on the
 * tick without any of them owning a timer.
 */

import { useSyncExternalStore } from "react";

import { Temporal } from "@otterdeploy/shared/temporal";

/**
 * Fine enough that "just now" turns into "1m ago" while the reader is still
 * looking, coarse enough to be nothing on a profile.
 */
const TICK_MS = 15_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Temporal.Now.instant().epochMilliseconds;

function tick() {
  now = Temporal.Now.instant().epochMilliseconds;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // The first subscriber starts the clock; the last one stops it. A background
  // tab with no relative timestamps mounted should not be waking up.
  timer ??= setInterval(tick, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

/** The current instant in epoch millis, re-read on a shared interval. */
export function useNowMs(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
