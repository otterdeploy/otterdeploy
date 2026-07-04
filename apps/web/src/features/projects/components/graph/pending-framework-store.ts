/**
 * Instant framework brand mark for a just-staged (ghost) service node.
 *
 * The framework is *persisted* on the resource row — but only after a build,
 * and a freshly-staged create has no resource row at all yet. The create
 * wizard, however, already knows the framework: `git.inspectRepo` returned it
 * while the operator picked the repo/root. This store carries that
 * client-known value from the wizard to the graph so the ghost node renders
 * the right logo (Next.js, Vite, …) the instant it appears — no round-trip,
 * no waiting for a build.
 *
 * It's a hint, not a source of truth: once the real resource lands (with its
 * own persisted framework) the graph reads that instead and the hint is
 * cleared. Same `useSyncExternalStore` shape as `applied-creates-store.ts`,
 * and the same key: `${resource}:${name}` (the graph node id).
 */

import type { Framework } from "@otterdeploy/shared/framework";

import { useSyncExternalStore } from "react";

// projectId → (nodeKey → detected framework)
const store = new Map<string, Map<string, Framework>>();
// Cached immutable snapshots so getSnapshot is stable between mutations
// (a fresh Map each call would loop useSyncExternalStore forever).
const snapshots = new Map<string, ReadonlyMap<string, Framework>>();
const listeners = new Set<() => void>();

const EMPTY: ReadonlyMap<string, Framework> = new Map();

function emit(projectId: string) {
  const m = store.get(projectId);
  snapshots.set(projectId, !m || m.size === 0 ? EMPTY : new Map(m));
  for (const l of listeners) l();
}

/** Record the framework the wizard detected for a staged service create. */
export function setPendingFramework(projectId: string, key: string, framework: Framework) {
  let m = store.get(projectId);
  if (!m) {
    m = new Map();
    store.set(projectId, m);
  }
  if (m.get(key) === framework) return;
  m.set(key, framework);
  emit(projectId);
}

/** Drop the hint once its real resource has landed (or the create was discarded). */
export function clearPendingFramework(projectId: string, key: string) {
  const m = store.get(projectId);
  if (m?.delete(key)) emit(projectId);
}

function getSnapshot(projectId: string): ReadonlyMap<string, Framework> {
  return snapshots.get(projectId) ?? EMPTY;
}

/** Subscribe a graph to the framework hints for its staged creates. */
export function usePendingFrameworks(projectId: string): ReadonlyMap<string, Framework> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => getSnapshot(projectId),
    () => EMPTY,
  );
}
