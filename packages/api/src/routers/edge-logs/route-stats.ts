/**
 * Pure merge for the `edgeLogs.routeStats` procedure: join a project's proxy
 * routes (host → owning resource) with the per-host stats the edge-log query
 * computed over the window. Every route comes back — hosts with no traffic are
 * zero-filled rather than dropped, so the Traffic tab can list a quiet host
 * honestly instead of pretending it doesn't exist.
 */

import type { EdgeHostStat } from "../../edge-logs/types";

export interface ProjectRouteRef {
  /** Canonical host (normalizeHost'd). */
  host: string;
  resourceId: string | null;
  isPrimary: boolean;
}

export interface RouteTraffic {
  rps: number;
  errorRate: number;
  p50: number;
  p95: number;
}

export type RouteStat = ProjectRouteRef & RouteTraffic;

/** Zero-filled traffic for a host that saw no requests in the window. */
const quiet: RouteTraffic = { rps: 0, errorRate: 0, p50: 0, p95: 0 };

/**
 * One output row per route, keyed by host. Stats for hosts outside the route
 * list are ignored (they can't occur — the query is scoped to these hosts —
 * but a stale stat must never invent a route). Busiest hosts first, then
 * alphabetical so the zero-traffic tail is stable. Generic so a caller's
 * branded `resourceId` type survives the merge.
 */
export function mergeRouteStats<R extends ProjectRouteRef>(
  routes: R[],
  hostStats: EdgeHostStat[],
): Array<R & RouteTraffic> {
  const statByHost = new Map(hostStats.map((s) => [s.host, s]));
  return routes
    .map((route) => {
      const s = statByHost.get(route.host);
      if (!s) return { ...route, ...quiet };
      return {
        ...route,
        rps: s.rps,
        errorRate: s.errorRate,
        p50: s.p50,
        p95: s.p95,
      };
    })
    .sort((a, b) => b.rps - a.rps || a.host.localeCompare(b.host));
}
