/**
 * One place that knows how the Firewall's four reads behave.
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
 *   prefetch      — warm all four on hover of the Edge nav item and on mount
 *                   of the page, so a tab click renders from cache.
 */
import type { QueryClient } from "@tanstack/react-query";

import { keepPreviousData } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

export type FirewallWindow = "1h" | "6h" | "24h" | "7d" | "all";
export type HistoryState = "all" | "active" | "ended";

/**
 * Live decisions. Polled, because this is the one view that answers "what is
 * blocked right now" and a stale answer there is a wrong answer. The poll is
 * what makes the 15s stale time safe: the data is never older than the tick.
 */
export const decisionsQuery = () => ({
  ...orpc.firewall.decisions.queryOptions(),
  staleTime: 15_000,
  refetchInterval: 15_000,
  placeholderData: keepPreviousData,
});

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
 * live rows at the top, which the recorder updates on its own schedule.
 */
export const historyQuery = (window: FirewallWindow, state: HistoryState) => ({
  ...orpc.firewall.history.queryOptions({ input: { window, state } }),
  staleTime: 60_000,
  placeholderData: keepPreviousData,
});

/**
 * Flagged IPs. Aggregated from edge logs at read time, so it is the most
 * expensive of the four; a minute of staleness costs nothing because the
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
