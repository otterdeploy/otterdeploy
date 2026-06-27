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
 *   - `deps`          — resubscribe when these change (useEffect deps)
 *
 * Reconnection itself is the client retry plugin's job — `open` opts in by
 * passing `context: { retry: Number.POSITIVE_INFINITY }` to the oRPC call.
 */

import { type DependencyList, useEffect, useRef, useState } from "react";

export type LogStreamStatus = "connecting" | "live" | "ended" | "error";

export interface UseLogStreamOptions<TRaw, TLine> {
  /** Open the oRPC event-iterator. Wire `signal` into the call options and,
   *  for auto-reconnect, pass `context: { retry: Number.POSITIVE_INFINITY }`. */
  open: (signal: AbortSignal) => Promise<AsyncIterable<TRaw>>;
  /** Map one raw event to a rendered line. `seq` is a monotonic id, handy as
   *  a React key. */
  map: (raw: TRaw, seq: number) => TLine;
  /** Resubscribe whenever any of these change (passed straight to useEffect). */
  deps: DependencyList;
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
  const { bufferSize, deps } = opts;
  const [lines, setLines] = useState<TLine[]>([]);
  const [status, setStatus] = useState<LogStreamStatus>("connecting");
  const seqRef = useRef(0);

  // Keep the latest callbacks / paused flag in refs so toggling them doesn't
  // tear down and re-open the stream — only `deps` does that. Refresh the ref
  // in a commit-time effect (never during render) — this runs before the
  // streaming effect below, so that effect always reads the latest `opts`.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    setLines([]);
    setStatus("connecting");
    seqRef.current = 0;

    const push = (line: TLine) => {
      setLines((prev) => {
        const next = [...prev, line];
        return bufferSize != null && next.length > bufferSize
          ? next.slice(next.length - bufferSize)
          : next;
      });
    };

    void (async () => {
      try {
        const stream = await optsRef.current.open(ctrl.signal);
        setStatus("live");
        for await (const raw of stream) {
          if (ctrl.signal.aborted) break;
          if (optsRef.current.paused) continue;
          push(optsRef.current.map(raw, ++seqRef.current));
        }
        if (!ctrl.signal.aborted) setStatus("ended");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setStatus("error");
        const errLine = optsRef.current.onError?.(err, ++seqRef.current);
        if (errLine != null) push(errLine);
      }
    })();

    return () => ctrl.abort();
    // `deps` is the caller-controlled resubscription trigger; callbacks are
    // read through optsRef so they intentionally don't retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { lines, status };
}
