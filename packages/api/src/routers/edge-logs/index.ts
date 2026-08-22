/**
 * Edge access logs router. Live tail + range query over the in-memory ring
 * buffer (packages/api/src/edge-logs), scoped to the caller's own domains.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { log } from "evlog";

import { orgScopedProcedure } from "../..";
import { type ResolvedActor } from "../../authz/actor";
import { authorizeCapability } from "../../authz/capability";
import {
  eventPersistenceEnabled,
  persistenceEnabled,
  queryEdgeEvents,
  queryEdgeEventsDb,
  queryEdgeLogs,
  queryEdgeLogsDb,
} from "../../edge-logs";
import { analyticsRunning } from "../../edge-logs/aggregate";
import {
  queryAnalyticsBreakdowns,
  queryAnalyticsOverview,
  resolveAnalyticsWindow,
} from "../../edge-logs/analytics-query";
import { geoAvailable } from "../../edge-logs/geo";
import { listProjectRoutes, listRouteUpstreams } from "./queries";
import { bucketRequestSeries, coveringRange } from "./request-series";
import { mergeRouteStats } from "./route-stats";
import { resolveHosts, streamEdgeEvents, streamEdgeLogs } from "./streams";

/**
 * Whether this install is recording traffic at all, resolved once per request
 * so both halves of a page report the same answer.
 *
 * This is the difference between "no requests in this window" (a measurement)
 * and "nothing has ever been measured" (the absence of one). The Analytics
 * page could not tell them apart before, so a dev install with EDGE_LOG_SINK
 * unset — where the rollup loop is never even started (apps/server bootstrap)
 * — blamed the time range for a condition no time range could fix.
 */
function collectionStatus(): { sinkConfigured: boolean; collecting: boolean } {
  return { sinkConfigured: Boolean(env.EDGE_LOG_SINK), collecting: analyticsRunning() };
}

/** DB-backed when persistence is on (covers long windows + survives restarts),
 *  else the in-memory ring; on a DB error (e.g. the table missing before
 *  `bun db:push`) fall back to the ring so pages render instead of 500-ing.
 *  `tag` names the caller in the fallback warning. */
async function withRingFallback<T>(
  enabled: boolean,
  tag: string,
  dbQuery: () => Promise<T>,
  ringQuery: () => T,
): Promise<{ result: T; servedFrom: "db" | "ring" }> {
  if (!enabled) return { result: ringQuery(), servedFrom: "ring" };
  const res = await Result.tryPromise({ try: dbQuery, catch: (cause) => cause });
  if (res.isOk()) return { result: res.value, servedFrom: "db" };
  log.warn({
    edgeLog: { [tag]: "db-failed-fallback-ring" },
    error: res.error instanceof Error ? res.error.message : String(res.error),
  });
  return { result: ringQuery(), servedFrom: "ring" };
}

/** Host scope for the analytics procedures. installWide = null scope (every
 *  host, control plane included) behind the server-owned install-admin
 *  attribute; otherwise the caller's org/project domains. The optional `host`
 *  input INTERSECTS with that scope, never replaces it: a host outside the
 *  scope leaves an empty list = honest zeros, not someone else's traffic. */
async function resolveAnalyticsHosts(
  input: { installWide?: boolean; projectId?: ProjectId; host?: string },
  context: {
    actor: ResolvedActor;
    activeOrganizationId: Parameters<typeof resolveHosts>[0];
  },
  forbid: (message: string) => never,
): Promise<string[] | null> {
  let hosts: string[] | null;
  if (input.installWide) {
    const decision = await authorizeCapability(context.actor, { scope: "install", mode: "read" });
    if (!decision.allowed) forbid(decision.reason);
    hosts = null;
  } else {
    hosts = await resolveHosts(context.activeOrganizationId, input.projectId);
  }
  if (input.host !== undefined) {
    const wanted = input.host.toLowerCase();
    hosts = hosts === null ? [wanted] : hosts.filter((h) => h === wanted);
  }
  return hosts;
}

export const edgeLogsRouter = {
  query: orgScopedProcedure.edgeLogs.query.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;
    const projectId = input.projectId;
    // `input.hosts` is the user-selected subset; `hosts` is the org scope
    // (the visibility guard). Keep them distinct in the filter.
    const { hosts: selectedHosts, ...rest } = input;
    // NOTE: never pass `hosts` (or any object used after this point) into a
    // log call here. Evlog's redaction mutates the event IN PLACE, and its
    // ipv4 masker rewrites sslip.io-style hosts (`x.65.108.240.250.sslip.io` →
    // `x.***.***.***.250.sslip.io`) inside the live array, silently emptying
    // every result. A "temporary" diagnostic that logged `resolvedHosts: hosts`
    // did exactly that and broke this endpoint in production (od bead: edge
    // logs query returns 0). Log a copy (`[...hosts]`) if it's ever needed.
    const hosts = await resolveHosts(orgId, input.projectId);
    const filter = { ...rest, hosts, selectedHosts };
    const now = Date.now();

    const { result } = await withRingFallback(
      persistenceEnabled(),
      "query",
      () => queryEdgeLogsDb(filter, now),
      () => queryEdgeLogs(filter, now),
    );

    // Resolve upstream per row from the route map (not in Caddy's log).
    const upstreams = await listRouteUpstreams(orgId, projectId);
    for (const row of result.rows) {
      if (!row.upstream) row.upstream = upstreams[row.host] ?? null;
    }
    return result;
  }),

  tail: orgScopedProcedure.edgeLogs.tail.handler(async function* ({ input, context, signal }) {
    const orgId = context.activeOrganizationId;
    const hosts = new Set(await resolveHosts(orgId, input.projectId));
    const upstreams = await listRouteUpstreams(orgId, input.projectId);
    for await (const line of streamEdgeLogs(hosts, input.host, signal)) {
      yield {
        ...line,
        upstream: line.upstream ?? upstreams[line.host] ?? null,
      };
    }
  }),

  // Per-host traffic stats for a project's HTTP routes, joined to the owning
  // resource. Short windows only (5m/1h): this backs a ~10s poll on the graph
  // and the stack panel's Traffic tab. Hosts with no traffic come back
  // zero-filled so consumers can list every public host honestly.
  routeStats: orgScopedProcedure.edgeLogs.routeStats.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;
    // Org-guarded join. A projectId outside the caller's org yields no routes.
    const routes = await listProjectRoutes(orgId, input.projectId);
    if (routes.length === 0) return [];

    // `limit: 1` keeps the row payload minimal. Only hostStats are consumed.
    const filter = { range: input.range, hosts: routes.map((r) => r.host), limit: 1 };
    const now = Date.now();
    const { result } = await withRingFallback(
      persistenceEnabled(),
      "routeStats",
      () => queryEdgeLogsDb(filter, now),
      () => queryEdgeLogs(filter, now),
    );

    return mergeRouteStats(routes, result.hostStats);
  }),

  // Bucketed rps + per-bucket p95 across all of one project's public hosts.
  // The request half of the project metrics overview (~30s poll). Same
  // storage split + ring fallback as `query`/`routeStats`; the fetch is
  // capped at REQUEST_SERIES_MAX newest rows (mirrors query-db's MAX_FETCH),
  // and `sampled: true` flags when that cap truncated the window.
  requestSeries: orgScopedProcedure.edgeLogs.requestSeries.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;
    context.log.set({ target: { type: "project", id: input.projectId } });

    // Org-guarded join. A projectId outside the caller's org yields no routes.
    const routes = await listProjectRoutes(orgId, input.projectId);
    const source = persistenceEnabled() ? ("db" as const) : ("ring" as const);
    if (routes.length === 0) {
      const empty = bucketRequestSeries([], input.windowMinutes, Date.now());
      return { ...empty, buckets: [], hostCount: 0, source, sampled: false };
    }

    const REQUEST_SERIES_MAX = 10_000;
    const range = coveringRange(input.windowMinutes);
    const filter = {
      range,
      hosts: routes.map((r) => r.host),
      limit: REQUEST_SERIES_MAX,
    };
    const now = Date.now();
    const { result, servedFrom } = await withRingFallback(
      source === "db",
      "requestSeries",
      () => queryEdgeLogsDb(filter, now),
      () => queryEdgeLogs(filter, now),
    );

    const { buckets, bucketSeconds } = bucketRequestSeries(result.rows, input.windowMinutes, now);
    return {
      buckets,
      bucketSeconds,
      hostCount: routes.length,
      source: servedFrom,
      sampled: result.rows.length >= REQUEST_SERIES_MAX,
    };
  }),

  // Operational log plane (Phase 3): cert/ACME + upstream-error events, scoped
  // to the caller's domains exactly like the access logs above.
  // Rollup-backed analytics: no ring fallback (the rollups always live in the
  // DB) and no raw-row scans, so every range costs the same. Host scope is the
  // same server-side resolve as everything else; the same evlog landmine
  // applies: never log the live `hosts` array.
  analytics: {
    overview: orgScopedProcedure.edgeLogs.analytics.overview.handler(
      async ({ input, context, errors }) => {
        // installWide = null host scope (every host, control plane included).
        // Server-owned install-admin attribute, same check the install-admin
        // middleware runs; org RBAC alone never grants it.
        const hosts = await resolveAnalyticsHosts(input, context, (message) => {
          throw errors.FORBIDDEN({ message });
        });
        const window = resolveAnalyticsWindow(input.range, input.from, input.to, Date.now());
        // The equal-length window immediately before, for the tiles' trend
        // deltas (rollup reads are cheap enough to just run twice).
        const span = window.toMs - window.fromMs;
        const previousWindow = {
          fromMs: window.fromMs - span,
          toMs: window.fromMs,
          bucketMinutes: window.bucketMinutes,
        };
        const collection = collectionStatus();
        const [current, previous] = await Promise.all([
          queryAnalyticsOverview(hosts, window, geoAvailable(), collection),
          queryAnalyticsOverview(hosts, previousWindow, geoAvailable(), collection),
        ]);
        return {
          ...current,
          previous: {
            requests: previous.summary.requests,
            visitorDays: previous.summary.visitorDays,
            bytesOut: previous.summary.bytesOut,
            p95: previous.summary.p95,
            errorRate: previous.summary.errorRate,
          },
        };
      },
    ),

    breakdowns: orgScopedProcedure.edgeLogs.analytics.breakdowns.handler(
      async ({ input, context, errors }) => {
        const hosts = await resolveAnalyticsHosts(input, context, (message) => {
          throw errors.FORBIDDEN({ message });
        });
        const window = resolveAnalyticsWindow(input.range, input.from, input.to, Date.now());
        const { breakdowns, flags } = await queryAnalyticsBreakdowns(
          hosts,
          window,
          geoAvailable(),
          collectionStatus(),
        );
        return { ...breakdowns, flags };
      },
    ),
  },

  events: {
    query: orgScopedProcedure.edgeLogs.events.query.handler(async ({ input, context }) => {
      const orgId = context.activeOrganizationId;
      const { hosts: selectedHosts, ...rest } = input;
      const hosts = await resolveHosts(orgId, input.projectId);
      const filter = { ...rest, hosts, selectedHosts };
      const now = Date.now();
      const { result } = await withRingFallback(
        eventPersistenceEnabled(),
        "eventsQuery",
        () => queryEdgeEventsDb(filter, now),
        () => queryEdgeEvents(filter, now),
      );
      return result;
    }),

    tail: orgScopedProcedure.edgeLogs.events.tail.handler(async function* ({
      input,
      context,
      signal,
    }) {
      const orgId = context.activeOrganizationId;
      const hosts = new Set(await resolveHosts(orgId, input.projectId));
      yield* streamEdgeEvents(hosts, input.host, signal);
    }),
  },
};
