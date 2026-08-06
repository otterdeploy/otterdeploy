/**
 * Trailing-window batcher for stream-driven resyncs, shared by the project
 * and org event hooks. Events arrive in bursts (a deploy emits one docker
 * event per container); every invalidation of an active query refetches
 * immediately, so unbatched handling costs one round trip per event. Keyed
 * scheduling collapses repeat announcements for the same cache entry into
 * one refetch per flush window.
 */
export interface ResyncBatcher {
  /** Queue `run` under `key`; a later call with the same key replaces it. */
  schedule: (key: string, run: () => void) => void;
  /** Drop anything queued and stop the pending flush (unmount/abort path). */
  cancel: () => void;
}

export function createResyncBatcher(windowMs: number): ResyncBatcher {
  const pending = new Map<string, () => void>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(key, run) {
      pending.set(key, run);
      flushTimer ??= setTimeout(() => {
        flushTimer = null;
        const batch = [...pending.values()];
        pending.clear();
        for (const flush of batch) flush();
      }, windowMs);
    },
    cancel() {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      pending.clear();
    },
  };
}
