/**
 * Data plane for the web-analytics dashboard: one place that turns URL state
 * (scope + range + filters) into `orpc.analytics.*` inputs and wraps the
 * queries with the page's polling and placeholder policy. Views stay layout;
 * every input shape lives here so the loader's prefetch and the components
 * agree on cache keys.
 */

import type { BreakdownDimension } from "@otterdeploy/shared/analytics-filters";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import type { WebAnalyticsFilter } from "../lib/filter-codec";
import type { RangeKey } from "../lib/range";

/** One tz lookup for the whole surface — the permitted use of the bare
 *  constructor; all *formatting* goes through @/shared/lib/clock.ts. */
export const BROWSER_TZ: string = Intl.DateTimeFormat().resolvedOptions().timeZone;

const POLL_MS = 30_000;
const REALTIME_POLL_MS = 10_000;

export interface AnalyticsScope {
  /** Resolved project id; absent = the whole org. */
  projectId?: string;
  /** Install admins with no project selected see the whole install. */
  installWide: boolean;
}

function scopeInput(scope: AnalyticsScope): { projectId?: string; installWide?: boolean } {
  if (scope.projectId !== undefined) return { projectId: scope.projectId };
  if (scope.installWide) return { installWide: true };
  return {};
}

export interface AnalyticsWindowState {
  range: RangeKey;
  from?: number;
  to?: number;
  filters: readonly WebAnalyticsFilter[];
}

function windowInput(win: AnalyticsWindowState) {
  const custom =
    win.range === "custom" && win.from !== undefined && win.to !== undefined
      ? { from: win.from, to: win.to }
      : {};
  return {
    range: win.range === "custom" && win.from === undefined ? ("7d" as const) : win.range,
    ...custom,
    tz: BROWSER_TZ,
    filters: [...win.filters],
  };
}

/** Overview always compares: the tiles' delta chips are part of the reading,
 *  and the extra totals query is cheap next to the series. */
function overviewInput(scope: AnalyticsScope, win: AnalyticsWindowState) {
  return { ...scopeInput(scope), ...windowInput(win), compare: true };
}

/** The loader's prefetch target for a cold navigation (default search). Must
 *  build the exact input the component will ask for, or the cache entry is
 *  wasted. */
export function defaultOverviewInput(isInstallAdmin: boolean) {
  return overviewInput({ installWide: isInstallAdmin }, { range: "7d", filters: [] });
}

const keepPrevious = { placeholderData: <T>(prev: T | undefined) => prev };

export function useOverview(scope: AnalyticsScope, win: AnalyticsWindowState) {
  return useQuery({
    ...orpc.analytics.overview.queryOptions({ input: overviewInput(scope, win) }),
    refetchInterval: POLL_MS,
    ...keepPrevious,
  });
}

export function useBreakdown(
  scope: AnalyticsScope,
  win: AnalyticsWindowState,
  dimension: BreakdownDimension,
  options: { limit: number; offset?: number; enabled?: boolean },
) {
  return useQuery({
    ...orpc.analytics.breakdown.queryOptions({
      input: {
        ...scopeInput(scope),
        ...windowInput(win),
        compare: false,
        dimension,
        limit: options.limit,
        offset: options.offset ?? 0,
      },
    }),
    refetchInterval: POLL_MS,
    enabled: options.enabled ?? true,
    ...keepPrevious,
  });
}

export function useRealtime(scope: AnalyticsScope, options?: { pollMs?: number }) {
  return useQuery({
    ...orpc.analytics.realtime.queryOptions({ input: scopeInput(scope) }),
    refetchInterval: options?.pollMs ?? REALTIME_POLL_MS,
    ...keepPrevious,
  });
}

export function useVisitorTrail(scope: AnalyticsScope, visitorId: string | null) {
  return useQuery({
    ...orpc.analytics.visitor.queryOptions({
      input: { ...scopeInput(scope), visitorId: visitorId ?? "loading-" },
    }),
    enabled: visitorId !== null,
    refetchInterval: REALTIME_POLL_MS,
  });
}

export function useEventDefinitions(scope: AnalyticsScope, win: AnalyticsWindowState) {
  return useQuery({
    ...orpc.analytics.events.list.queryOptions({
      input: { ...scopeInput(scope), ...windowInput(win), compare: false },
    }),
    refetchInterval: POLL_MS,
    ...keepPrevious,
  });
}

const VERIFY_POLL_MS = 5_000;

/**
 * One project's site row. While the site exists but has never seen an event,
 * polls every 5 s so "Waiting for the first pageview" flips to verified the
 * moment the snippet fires.
 */
export function useSite(projectId: string | undefined) {
  return useQuery({
    ...orpc.analytics.site.get.queryOptions({
      input: { projectId: projectId ?? "loading-" },
    }),
    enabled: projectId !== undefined,
    refetchInterval: (query) => {
      const site = query.state.data?.site;
      return site && site.firstEventAt === null ? VERIFY_POLL_MS : false;
    },
  });
}
