/**
 * Edge access logs router. Live tail + range query over the in-memory ring
 * buffer (packages/api/src/edge-logs), scoped to the caller's own domains.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { edgeLog } from "@otterdeploy/db/schema/edge-log";
import { Result } from "better-result";
import { log } from "evlog";

import { orgScopedProcedure } from "../..";
import {
  eventPersistenceEnabled,
  persistenceEnabled,
  queryEdgeEvents,
  queryEdgeEventsDb,
  queryEdgeLogs,
  queryEdgeLogsDb,
} from "../../edge-logs";
import { listProjectRoutes, listRouteUpstreams } from "./queries";
import { bucketRequestSeries, coveringRange } from "./request-series";
import { mergeRouteStats } from "./route-stats";
import { resolveHosts, streamEdgeEvents, streamEdgeLogs } from "./streams";

export const edgeLogsRouter = {
  query: orgScopedProcedure.edgeLogs.query.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;
    const projectId = input.projectId;
    // `input.hosts` is the user-selected subset; `hosts` is the org scope
    // (the visibility guard). Keep them distinct in the filter.
    const { hosts: selectedHosts, ...rest } = input;
    const hosts = await resolveHosts(orgId, input.projectId);
    const filter = { ...rest, hosts, selectedHosts };
    const now = Date.now();

    // TEMP diagnostic: the project edge-logs view comes back empty. Compare the
    // domains we resolved for this project against the distinct hosts actually
    // present in edge_log — a mismatch (or empty resolvedHosts) is the cause.
    {
      const distinct = await Result.tryPromise({
        try: () => db.selectDistinct({ host: edgeLog.host }).from(edgeLog).limit(50),
        catch: (cause) => cause,
      });
      log.info({
        edgeLog: {
          diag: "query-scope",
          projectId: input.projectId ?? null,
          resolvedHosts: hosts,
          loggedHosts: distinct.isOk()
            ? distinct.value.map((r) => r.host)
            : "distinct-query-failed",
        },
      });
    }

    // DB-backed when persistence is on (covers 24h/7d + survives restarts);
    // otherwise the in-memory ring. Fall back to the ring if the DB query
    // fails (e.g. edge_log missing before `bun db:push`) so the page still
    // renders instead of 500-ing.
    let result;
    if (!persistenceEnabled()) {
      result = queryEdgeLogs(filter, now);
    } else {
      const res = await Result.tryPromise({
        try: () => queryEdgeLogsDb(filter, now),
        catch: (cause) => cause,
      });
      if (res.isOk()) result = res.value;
      else {
        log.warn({
          edgeLog: { query: "db-failed-fallback-ring" },
          error: res.error instanceof Error ? res.error.message : String(res.error),
        });
        result = queryEdgeLogs(filter, now);
      }
    }

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
    const upstreams = await listRouteUpstreams(orgId, input.projectId as ProjectId | undefined);
    for await (const line of streamEdgeLogs(hosts, input.host, signal)) {
      yield {
        ...line,
        upstream: line.upstream ?? upstreams[line.host] ?? null,
      };
    }
  }),

  // Per-host traffic stats for a project's HTTP routes, joined to the owning
  // resource. Short windows only (5m/1h) — this backs a ~10s poll on the graph
  // and the stack panel's Traffic tab. Hosts with no traffic come back
  // zero-filled so consumers can list every public host honestly.
  routeStats: orgScopedProcedure.edgeLogs.routeStats.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;
    // Org-guarded join — a projectId outside the caller's org yields no routes.
    const routes = await listProjectRoutes(orgId, input.projectId);
    if (routes.length === 0) return [];

    // `limit: 1` keeps the row payload minimal — only hostStats are consumed.
    const filter = { range: input.range, hosts: routes.map((r) => r.host), limit: 1 };
    const now = Date.now();
    // Same storage split + fallback as `query` above: DB when persistence is
    // on (fall back to the ring on error), else the in-memory ring.
    let result;
    if (!persistenceEnabled()) {
      result = queryEdgeLogs(filter, now);
    } else {
      const res = await Result.tryPromise({
        try: () => queryEdgeLogsDb(filter, now),
        catch: (cause) => cause,
      });
      if (res.isOk()) result = res.value;
      else {
        log.warn({
          edgeLog: { routeStats: "db-failed-fallback-ring" },
          error: res.error instanceof Error ? res.error.message : String(res.error),
        });
        result = queryEdgeLogs(filter, now);
      }
    }

    return mergeRouteStats(routes, result.hostStats);
  }),

  // Bucketed rps + per-bucket p95 across all of one project's public hosts —
  // the request half of the project metrics overview (~30s poll). Same
  // storage split + ring fallback as `query`/`routeStats`; the fetch is
  // capped at REQUEST_SERIES_MAX newest rows (mirrors query-db's MAX_FETCH),
  // and `sampled: true` flags when that cap truncated the window.
  requestSeries: orgScopedProcedure.edgeLogs.requestSeries.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;
    context.log.set({ target: { type: "project", id: input.projectId } });

    // Org-guarded join — a projectId outside the caller's org yields no routes.
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
    let result;
    let servedFrom = source;
    if (source === "ring") {
      result = queryEdgeLogs(filter, now);
    } else {
      const res = await Result.tryPromise({
        try: () => queryEdgeLogsDb(filter, now),
        catch: (cause) => cause,
      });
      if (res.isOk()) result = res.value;
      else {
        log.warn({
          edgeLog: { requestSeries: "db-failed-fallback-ring" },
          error: res.error instanceof Error ? res.error.message : String(res.error),
        });
        result = queryEdgeLogs(filter, now);
        servedFrom = "ring";
      }
    }

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
  events: {
    query: orgScopedProcedure.edgeLogs.events.query.handler(async ({ input, context }) => {
      const orgId = context.activeOrganizationId;
      const { hosts: selectedHosts, ...rest } = input;
      const hosts = await resolveHosts(orgId, input.projectId);
      const filter = { ...rest, hosts, selectedHosts };
      const now = Date.now();
      // DB-backed when persistence is on (survives restarts); else the ring.
      // Fall back to the ring on a DB error so the page still renders.
      if (!eventPersistenceEnabled()) return queryEdgeEvents(filter, now);
      const res = await Result.tryPromise({
        try: () => queryEdgeEventsDb(filter, now),
        catch: (cause) => cause,
      });
      if (res.isOk()) return res.value;
      log.warn({
        edgeLog: { eventsQuery: "db-failed-fallback-ring" },
        error: res.error instanceof Error ? res.error.message : String(res.error),
      });
      return queryEdgeEvents(filter, now);
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
