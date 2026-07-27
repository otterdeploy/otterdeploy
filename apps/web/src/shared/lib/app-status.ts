/**
 * App-wide status rollup — what the browser tab should be saying right now.
 *
 * Several places know something worth reporting (a project's live task states, a
 * long-running mutation), and none of them own the tab. So they each *report*
 * under a key and this module resolves the winner. Reporting is idempotent and
 * clearing is explicit, so a source that unmounts cannot leave the tab stuck.
 *
 * This is deliberately a plain external store rather than context: the favicon
 * controller lives outside the React tree that produces the signal, and a
 * context would force every reporter to live under one provider.
 */

import { useEffect, useSyncExternalStore } from "react";

import type { MarkStatus } from "@/shared/components/brand/mark-geometry";

/**
 * Most-concerning state wins, matching `rollupStatus` in the project graph
 * (build-live-nodes.ts) so the tab and the node never disagree about which of
 * two simultaneous states is the headline.
 */
const PRIORITY: readonly MarkStatus[] = ["error", "deploying", "warning", "success", "idle"];

const sources = new Map<string, MarkStatus>();
const listeners = new Set<() => void>();
let snapshot: MarkStatus = "idle";

function resolve(): MarkStatus {
  for (const status of PRIORITY) {
    if (status === "idle") break;
    for (const reported of sources.values()) if (reported === status) return status;
  }
  return "idle";
}

function publish(): void {
  const next = resolve();
  // useSyncExternalStore compares snapshots by identity; only notify on a real
  // change, or every poll tick of the underlying live query would re-render.
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Records (or with `null`, withdraws) one source's opinion.
 *
 * `key` should be stable per source — reporting again under the same key
 * replaces that source's previous value rather than stacking.
 */
function reportAppStatus(key: string, status: MarkStatus | null): void {
  if (status === null || status === "idle") {
    if (!sources.delete(key)) return;
  } else {
    if (sources.get(key) === status) return;
    sources.set(key, status);
  }
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): MarkStatus => snapshot;

/** The current rollup. */
export function useAppStatus(): MarkStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Reports `status` for as long as the calling component is mounted, and
 * withdraws it on unmount. The common case — a route that knows about its own
 * subtree's health and should not outlive it.
 */
export function useReportAppStatus(key: string, status: MarkStatus | null): void {
  useEffect(() => {
    reportAppStatus(key, status);
  }, [key, status]);

  // Separate from the report effect so a changing `status` does not churn the
  // cleanup — this one runs only when the key changes or on unmount.
  useEffect(() => () => reportAppStatus(key, null), [key]);
}
