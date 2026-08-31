/**
 * One place that knows how the Firewall's reads behave.
 *
 * The tabs used to fetch on mount, so every switch showed an empty table for a
 * beat and then filled in — and the same trip happened again on the way back,
 * because nothing kept the answer. Three things fix that, and they belong
 * together rather than scattered across the panels:
 *
 *   `staleTime`   — how long an answer stays good enough to render instantly.
 *                   Different per read, because the underlying data moves at
 *                   different speeds.
 *   `placeholder` — while refetching, keep showing the last rows instead of
 *                   dropping to a skeleton. This is what removes the flash on
 *                   a window change, where the shape of the answer is the same
 *                   and only its contents move.
 *   prefetch      — warm every read on hover of the Edge nav item and on mount
 *                   of the page, so a tab click renders from cache.
 */
import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";
import type { QueryClient } from "@tanstack/react-query";

import { keepPreviousData } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

export type FirewallWindow = "1h" | "6h" | "24h" | "7d" | "all";
export type HistoryState = "all" | "active" | "ended";

/**
 * The Blocked tab's one axis: how far back to look.
 *
 * This was two controls — a tense (`enforcing` / `expired`) and, only when the
 * tense was `expired`, a window. Which meant the window picker appeared and
 * vanished as you switched tense, moving every control beside it. Two controls
 * for what an operator experiences as one question ("what is blocked, and how
 * far back do I care") is one too many.
 *
 * `now` is the live LAPI read: what is being enforced this second, which is
 * the only thing that can answer that honestly. Every other option is our
 * recorder's table over that window, which is the only place a ban CrowdSec
 * has already dropped still exists — and it returns BOTH tenses, because the
 * Status column already says which each row is.
 */
export const BLOCKED_RANGES = ["now", "1h", "6h", "24h", "7d", "all"] as const;
export type BlockedRange = (typeof BLOCKED_RANGES)[number];

/** Ascending, then `all` — reads as a scale rather than a shuffled set. */
export const WINDOWS = ["1h", "6h", "24h", "7d", "all"] as const;

/**
 * Enforced right now, or over and done with.
 *
 * A filter and not just a column, because "show me only the ones that ended"
 * was previously answerable only by typing `expired` into the search box —
 * true, and completely invisible. It is meaningful at every range: under `now`
 * it simply reports that nothing in a live snapshot has expired, which is a
 * fact rather than a broken control, and the counts on it say so out loud.
 */
export const BLOCKED_STATES = ["all", "enforcing", "expired"] as const;
export type BlockedState = (typeof BLOCKED_STATES)[number];

export type FlaggedRow = InferRouterOutputs<AppRouter>["firewall"]["flagged"][number];

/** Everything the search box matches a Flagged row on. */
export function flaggedFields(row: FlaggedRow): ReadonlyArray<string | number | null | undefined> {
  return [row.ip, row.country, row.count, ...row.samplePaths];
}

/**
 * Live decisions, for the prefetch only.
 *
 * Nothing renders from this query. The decisions themselves live in
 * `./decisions`, a collection whose observer polls the SAME key — so warming
 * that key here means the collection has its first answer before anything
 * subscribes, which is the whole point of the prefetch. The poll and the stale
 * time belong to the collection; this just fills the cache entry it reads.
 */
const decisionsQuery = () => orpc.firewall.decisions.queryOptions();

/** Agent reachability. Cheap, and it drives whether the rest of the page is
 *  even meaningful, so it polls alongside decisions. */
export const statusQuery = () => ({
  ...orpc.firewall.status.queryOptions(),
  staleTime: 15_000,
  refetchInterval: 15_000,
});

/**
 * Recorded history. Our own table, and the past does not change — a decision
 * that ended yesterday will still have ended yesterday in a minute's time. So
 * it holds for a minute and never polls; the only thing that moves is the
 * live set, which the Blocked tab reads from the LAPI instead.
 */
export const historyQuery = (window: FirewallWindow, state: HistoryState) => ({
  ...orpc.firewall.history.queryOptions({ input: { window, state } }),
  staleTime: 60_000,
  placeholderData: keepPreviousData,
});

/**
 * Flagged IPs. Aggregated from edge logs at read time, so it is the most
 * expensive of the reads; a minute of staleness costs nothing because the
 * rollup it reads is itself written at ingest.
 */
export const flaggedQuery = (window: FirewallWindow) => ({
  ...orpc.firewall.flagged.queryOptions({ input: { window } }),
  staleTime: 60_000,
  placeholderData: keepPreviousData,
});

/** Managed blocklists. Changes only when an operator changes them. */
export const blocklistsQuery = () => ({
  ...orpc.firewall.blocklists.list.queryOptions(),
  staleTime: 5 * 60_000,
});

/**
 * Warm every tab's first page.
 *
 * Called from the route loader (so an intent-preload on the nav link fetches
 * before the click) and again on mount (so a direct navigation still lands on
 * warm data). `prefetchQuery` is a no-op when the entry is already fresh, so
 * calling it twice costs one request, not two.
 *
 * Deliberately fire-and-forget: a slow firewall read must not hold up the page
 * that contains it, and each panel still has its own loading state for the
 * case where the prefetch hasn't landed.
 */
export function prefetchFirewall(queryClient: QueryClient): void {
  void queryClient.prefetchQuery(statusQuery());
  void queryClient.prefetchQuery(decisionsQuery());
  // The defaults each tab opens on. A different window is one fetch away and
  // keeps the previous rows on screen while it loads (see placeholderData).
  void queryClient.prefetchQuery(historyQuery("7d", "all"));
  void queryClient.prefetchQuery(flaggedQuery("all"));
  void queryClient.prefetchQuery(blocklistsQuery());
}
