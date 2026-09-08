/**
 * Tailing: new rows arrive at the top while you read.
 *
 * It polls `fetchPreviousPage`, which walks the cursor toward NEWER rows, so
 * arrivals are prepended to the same page list rather than replacing it. A
 * plain refetch would discard everything scrolled to and put the reader back at
 * the top, which is the opposite of what a tail is for.
 *
 * The activation instant is state adjusted DURING RENDER rather than a ref
 * written from an effect. It is read while rendering — every row older than it
 * is dimmed — and turning the tail off triggers no fetch of its own, so a ref
 * would leave the rows dimmed until some unrelated fetch happened to rebuild
 * them. Comparing the previous value during render lets React re-run this
 * component before committing, so no frame is ever painted with the wrong one.
 */

import { useEffect, useState } from "react";

import { Temporal } from "@otterdeploy/shared/temporal";

/** Slow enough not to be a load generator, fast enough to feel live. */
const POLL_MS = 5_000;

export interface LiveTail {
  /** Rows at or before this instant were already there when tailing began. */
  since: number | undefined;
  /** True while the tail is running. */
  isLive: boolean;
}

export function useLiveTail(params: {
  enabled: boolean;
  fetchPreviousPage: () => void;
  intervalMs?: number;
}): LiveTail {
  const { enabled, fetchPreviousPage, intervalMs = POLL_MS } = params;

  const [since, setSince] = useState<number | undefined>(() =>
    enabled ? Temporal.Now.instant().epochMilliseconds : undefined,
  );
  const [wasEnabled, setWasEnabled] = useState(enabled);

  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    setSince(enabled ? Temporal.Now.instant().epochMilliseconds : undefined);
  }

  useEffect(() => {
    if (!enabled) return;
    // An interval, not a recursive timeout chain: a fetch that hangs must not
    // stop the tail, and the query layer already de-duplicates in-flight pages.
    const timer = setInterval(fetchPreviousPage, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, fetchPreviousPage, intervalMs]);

  return { since, isLive: enabled };
}

/**
 * Rows that were already on screen when tailing began, dimmed.
 *
 * The dimming is the whole point of the activation instant: it separates "this
 * arrived while I was watching" from "this was here when I started", which is
 * the question someone tailing a feed is actually asking.
 */
export function tailRowClassName(since: number | undefined, rowAtMs: number): string | undefined {
  if (since === undefined) return undefined;
  return rowAtMs <= since ? "opacity-60" : undefined;
}
