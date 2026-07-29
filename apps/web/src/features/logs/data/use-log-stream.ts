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
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type LogStreamStatus = "connecting" | "live" | "ended" | "error";

interface StreamSnapshot<TLine> {
  lines: TLine[];
  status: LogStreamStatus;
}

/**
 * The tail's buffer, deliberately outside React state.
 *
 * A stream is an external source and this is its accumulator, so React reads it
 * through `useSyncExternalStore`. That's not a detail: clearing the buffer is
 * part of *opening* a subscription (the previous stream's lines describe a
 * resource we no longer tail), and expressing that as a `setState` in an effect
 * body is the cascading-render anti-pattern. As a store it's one external
 * update, and appends cost one commit each instead of one per `setState` pair.
 */
class StreamBuffer<TLine> {
  #lines: TLine[] = [];
  #status: LogStreamStatus = "connecting";
  // Cached so repeat reads are referentially equal — useSyncExternalStore
  // re-renders forever if getSnapshot returns a fresh object every call.
  #snapshot: StreamSnapshot<TLine> = { lines: [], status: "connecting" };
  #listeners = new Set<() => void>();

  subscribe = (onChange: () => void): (() => void) => {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  };

  getSnapshot = (): StreamSnapshot<TLine> => this.#snapshot;

  #commit() {
    this.#snapshot = { lines: this.#lines, status: this.#status };
    for (const listener of this.#listeners) listener();
  }

  /** Setup step for a new subscription: drop the old stream's lines. */
  reset() {
    this.#lines = [];
    this.#status = "connecting";
    this.#commit();
  }

  setStatus(status: LogStreamStatus) {
    this.#status = status;
    this.#commit();
  }

  push(line: TLine, bufferSize?: number) {
    const next = [...this.#lines, line];
    this.#lines =
      bufferSize != null && next.length > bufferSize ? next.slice(next.length - bufferSize) : next;
    this.#commit();
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
}

export function useLogStream<TRaw, TLine>(
  opts: UseLogStreamOptions<TRaw, TLine>,
): { lines: TLine[]; status: LogStreamStatus } {
  const { bufferSize, key } = opts;
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
        if (!ctrl.signal.aborted) buffer.setStatus("ended");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        buffer.setStatus("error");
        const errLine = optsRef.current.onError?.(err, ++seqRef.current);
        if (errLine != null) buffer.push(errLine, bufferSize);
      }
    })();

    return () => ctrl.abort();
  }, [key, buffer, bufferSize]);

  return useSyncExternalStore(buffer.subscribe, buffer.getSnapshot);
}
