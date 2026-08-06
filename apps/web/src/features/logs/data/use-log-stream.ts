/**
 * useLogStream — one hook for every live log/event tail in the app.
 *
 * Each viewer used to hand-roll the same effect: open an oRPC event-iterator,
 * flip a `connecting → live → ended | error` status, accumulate lines behind a
 * monotonic counter, abort on unmount, and (sometimes) ring-buffer. That
 * boilerplate lived in four places; this is the single copy.
 *
 * Generic over the raw event (`TRaw`) and the rendered line (`TLine`) so it
 * serves both the simple `{ stream, line, ts }` tails and the richer
 * project-wide fan-in. The caller supplies:
 *   - `open(signal)`  — start the stream (wire the abort signal + retry context)
 *   - `map(raw, seq)` — turn one event into a line; `seq` is a stable key
 *   - `key`           — resubscribe whenever this changes
 *
 * Reconnection itself is the client retry plugin's job — `open` opts in by
 * passing `context: { retry: Number.POSITIVE_INFINITY }` to the oRPC call.
 *
 * Two things this hook has to get right, both learned from the deployment log
 * tabs feeling slow and "reloading" every time you came back to them:
 *
 *  1. It is mounted inside React `<Activity>`. Hidden Activity preserves state
 *     but UNMOUNTS EFFECTS, so leaving a tab aborts the stream and returning
 *     re-runs this effect. Re-streaming a finished build from byte zero on
 *     every visit is pure waste — see `finished` below.
 *  2. A commit per line is a render per line. Appends are batched to one
 *     animation frame, which also makes the snapshot copy once per frame
 *     instead of once per line (it was O(n²) over a build log).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type LogStreamStatus = "connecting" | "live" | "ended" | "error";

interface StreamSnapshot<TLine> {
  lines: TLine[];
  status: LogStreamStatus;
}

/**
 * Completed tails, kept by `key` so re-entering a tab (or re-opening the same
 * deployment) paints instantly instead of re-streaming.
 *
 * ONLY terminal streams are cached. A live tail must always reconnect — serving
 * it from here would silently freeze the log at whatever was on screen when you
 * navigated away, which is exactly the kind of quietly-stale UI this codebase
 * treats as a bug. Bounded so a long session can't grow it without limit.
 */
const MAX_CACHED_STREAMS = 24;
const finished = new Map<string, StreamSnapshot<unknown>>();

function remember<TLine>(key: string, snapshot: StreamSnapshot<TLine>): void {
  // Re-insert so the map's insertion order is a true LRU, then evict the oldest.
  finished.delete(key);
  finished.set(key, snapshot as StreamSnapshot<unknown>);
  if (finished.size > MAX_CACHED_STREAMS) {
    const oldest = finished.keys().next();
    if (!oldest.done) finished.delete(oldest.value);
  }
}

/**
 * The tail's buffer, deliberately outside React state.
 *
 * A stream is an external source and this is its accumulator, so React reads it
 * through `useSyncExternalStore`. That's not a detail: clearing the buffer is
 * part of *opening* a subscription (the previous stream's lines describe a
 * resource we no longer tail), and expressing that as a `setState` in an effect
 * body is the cascading-render anti-pattern.
 */
class StreamBuffer<TLine> {
  // MUTABLE working array — push appends in place, and the immutable copy
  // happens once per commit (one rAF), not once per line. The old
  // copy-on-push made a burst of N lines against a full buffer O(N × buffer)
  // in element copies inside a single tick.
  #lines: TLine[] = [];
  #bufferSize: number | undefined;
  #status: LogStreamStatus = "connecting";
  // Cached so repeat reads are referentially equal — useSyncExternalStore
  // re-renders forever if getSnapshot returns a fresh object every call.
  #snapshot: StreamSnapshot<TLine> = { lines: [], status: "connecting" };
  #listeners = new Set<() => void>();
  #flush: number | null = null;

  subscribe = (onChange: () => void): (() => void) => {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  };

  getSnapshot = (): StreamSnapshot<TLine> => this.#snapshot;

  #commit() {
    // Exact cap enforced here (push only bounds growth at 2×), then a shallow
    // copy so the snapshot the UI holds is immutable while #lines keeps
    // mutating underneath it.
    if (this.#bufferSize != null && this.#lines.length > this.#bufferSize) {
      this.#lines = this.#lines.slice(-this.#bufferSize);
    }
    this.#snapshot = { lines: this.#lines.slice(), status: this.#status };
    for (const listener of this.#listeners) listener();
  }

  /** Coalesce a burst of appends into one commit. A build replaying hundreds of
   *  buffered lines arrives in a single tick; without this each line is its own
   *  React render. */
  #scheduleCommit() {
    if (this.#flush != null) return;
    this.#flush = requestAnimationFrame(() => {
      this.#flush = null;
      this.#commit();
    });
  }

  #cancelPending() {
    if (this.#flush == null) return;
    cancelAnimationFrame(this.#flush);
    this.#flush = null;
  }

  /** Setup step for a new subscription: drop the old stream's lines. */
  reset() {
    this.#cancelPending();
    this.#lines = [];
    this.#status = "connecting";
    this.#commit();
  }

  /** Adopt a previously completed stream without re-fetching it. */
  restore(snapshot: StreamSnapshot<TLine>) {
    this.#cancelPending();
    // Own a mutable copy — the cached snapshot must stay frozen.
    this.#lines = snapshot.lines.slice();
    this.#status = snapshot.status;
    this.#commit();
  }

  /** Status changes are terminal or user-visible, so they commit immediately —
   *  a pending batched append is folded into the same commit. */
  setStatus(status: LogStreamStatus) {
    this.#cancelPending();
    this.#status = status;
    this.#commit();
  }

  push(line: TLine, bufferSize?: number) {
    this.#bufferSize = bufferSize;
    this.#lines.push(line);
    // Amortized trim: only stop unbounded growth during a burst — the exact
    // cap is applied once at commit time.
    if (bufferSize != null && this.#lines.length > bufferSize * 2) {
      this.#lines = this.#lines.slice(-bufferSize);
    }
    this.#scheduleCommit();
  }

  snapshotNow(): StreamSnapshot<TLine> {
    return { lines: this.#lines.slice(), status: this.#status };
  }

  dispose() {
    this.#cancelPending();
  }
}

export interface UseLogStreamOptions<TRaw, TLine> {
  /** Open the oRPC event-iterator. Wire `signal` into the call options and,
   *  for auto-reconnect, pass `context: { retry: Number.POSITIVE_INFINITY }`. */
  open: (signal: AbortSignal) => Promise<AsyncIterable<TRaw>>;
  /** Map one raw event to a rendered line. `seq` is a monotonic id, handy as
   *  a React key. */
  map: (raw: TRaw, seq: number) => TLine;
  /** Identity of the thing being tailed. Changing it tears the stream down and
   *  opens a fresh one; callers join their inputs into one string. A single
   *  value rather than a dep array so the effect below keeps a literal dep
   *  list that a dependency checker can actually verify. */
  key: string;
  /** Ring-buffer cap. Omit for unbounded. */
  bufferSize?: number;
  /** Suspend appends without dropping the buffer (live ↔ paused toggle). */
  paused?: boolean;
  /** Produce a line to append when the stream errors terminally. Return null
   *  to record the error status without adding a line. */
  onError?: (err: unknown, seq: number) => TLine | null;
  /** Replay a finished tail from memory instead of re-streaming it when this
   *  hook's effects are re-mounted (tab switch, navigation back).
   *
   *  Opt-IN, because "ended" only means "replayable" for an immutable log like
   *  a finished build. A runtime tail also ends — when the container stops —
   *  and must re-attach when it comes back, so serving that from cache would
   *  freeze the view at yesterday's output. */
  cacheCompleted?: boolean;
}

export function useLogStream<TRaw, TLine>(
  opts: UseLogStreamOptions<TRaw, TLine>,
): { lines: TLine[]; status: LogStreamStatus } {
  const { bufferSize, key, cacheCompleted } = opts;
  const [buffer] = useState(() => new StreamBuffer<TLine>());
  const seqRef = useRef(0);

  // Keep the latest callbacks / paused flag in refs so toggling them doesn't
  // tear down and re-open the stream — only `key` does that. Refresh the ref
  // in a commit-time effect (never during render) — this runs before the
  // streaming effect below, so that effect always reads the latest `opts`.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    // A finished tail for this exact key: paint it and skip the network
    // entirely. This is what makes returning to a completed build's logs
    // instant instead of a full re-stream.
    const cached = cacheCompleted
      ? (finished.get(key) as StreamSnapshot<TLine> | undefined)
      : undefined;
    if (cached) {
      buffer.restore(cached);
      return () => buffer.dispose();
    }

    const ctrl = new AbortController();
    buffer.reset();
    seqRef.current = 0;

    void (async () => {
      try {
        const stream = await optsRef.current.open(ctrl.signal);
        buffer.setStatus("live");
        for await (const raw of stream) {
          if (ctrl.signal.aborted) break;
          if (optsRef.current.paused) continue;
          buffer.push(optsRef.current.map(raw, ++seqRef.current), bufferSize);
        }
        if (!ctrl.signal.aborted) {
          buffer.setStatus("ended");
          // Only a stream that ran to completion is worth replaying. A tail cut
          // short by navigation is partial by definition.
          if (cacheCompleted) remember(key, buffer.snapshotNow());
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        buffer.setStatus("error");
        const errLine = optsRef.current.onError?.(err, ++seqRef.current);
        if (errLine != null) buffer.push(errLine, bufferSize);
      }
    })();

    return () => {
      ctrl.abort();
      buffer.dispose();
    };
  }, [key, buffer, bufferSize, cacheCompleted]);

  return useSyncExternalStore(buffer.subscribe, buffer.getSnapshot);
}
