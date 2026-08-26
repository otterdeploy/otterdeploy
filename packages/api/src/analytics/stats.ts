/**
 * Per-site collect counters. In-memory only (design §2: the rejected
 * counter is "surfaced on Setup, never persisted"), reset on restart, held
 * on `globalThis` so a hot reload doesn't zero them.
 */

import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

export interface CollectStats {
  /** Events that became rows or session updates. */
  accepted: number;
  /** Batches dropped because the UA classified as a bot. */
  bots: number;
  /** Events whose page host was outside the allowlist. */
  rejectedHost: number;
  /** Events whose path matched an `exclude_paths` glob. */
  rejectedPath: number;
  /** Events with an unparseable URL, or batches that threw unexpectedly. */
  invalid: number;
  /** Batches refused by the per-IP limiter. */
  rateLimited: number;
}

export type CollectStatKey = keyof CollectStats;

declare global {
  var __analyticsCollectStats: Map<AnalyticsSiteId, CollectStats> | undefined;
}

function store(): Map<AnalyticsSiteId, CollectStats> {
  globalThis.__analyticsCollectStats ??= new Map();
  return globalThis.__analyticsCollectStats;
}

function fresh(): CollectStats {
  return { accepted: 0, bots: 0, rejectedHost: 0, rejectedPath: 0, invalid: 0, rateLimited: 0 };
}

export function bumpStat(siteId: AnalyticsSiteId, key: CollectStatKey, by = 1): void {
  let stats = store().get(siteId);
  if (!stats) {
    stats = fresh();
    store().set(siteId, stats);
  }
  stats[key] += by;
}

/** Snapshot (a copy) of one site's counters since process start. */
export function collectStats(siteId: AnalyticsSiteId): CollectStats {
  return { ...(store().get(siteId) ?? fresh()) };
}

/** Test / hot-reload helper. */
export function resetCollectStats(): void {
  store().clear();
}
