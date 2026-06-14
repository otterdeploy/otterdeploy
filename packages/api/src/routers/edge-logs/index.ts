/**
 * Edge access logs router. Live tail + range query over the in-memory ring
 * buffer (packages/api/src/edge-logs), scoped to the caller's own domains.
 */

import type { ProjectId } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { log } from "evlog";

import { db } from "@otterdeploy/db";
import { edgeLog } from "@otterdeploy/db/schema/edge-log";

import { orgScopedProcedure } from "../..";
import {
  type EdgeLogLine,
  persistenceEnabled,
  queryEdgeLogs,
  queryEdgeLogsDb,
  subscribeEdgeLogs,
} from "../../edge-logs";

import {
  listOrgDomains,
  listProjectDomains,
  listRouteUpstreams,
} from "./queries";

/** Resolve the access-log host scope: a project's domains when projectId is
 *  given (org-verified), otherwise all the org's domains. */
async function resolveHosts(
  organizationId: Parameters<typeof listOrgDomains>[0],
  projectId: string | undefined,
): Promise<string[]> {
  return projectId
    ? listProjectDomains(organizationId, projectId as ProjectId)
    : listOrgDomains(organizationId);
}

/** Bridge the ring's pub/sub into an abortable async generator with a small
 *  backpressure queue. Only the org's own hosts (optionally one) pass. */
async function* streamEdgeLogs(
  hosts: Set<string>,
  hostFilter: string | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<EdgeLogLine> {
  const queue: EdgeLogLine[] = [];
  let wake: (() => void) | null = null;

  const unsub = subscribeEdgeLogs((line) => {
    if (!hosts.has(line.host)) return;
    if (hostFilter && line.host !== hostFilter) return;
    queue.push(line);
    wake?.();
  });
  const onAbort = () => wake?.();
  signal?.addEventListener("abort", onAbort);

  try {
    while (!signal?.aborted) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      yield queue?.shift();
    }
  } finally {
    unsub();
    signal?.removeEventListener("abort", onAbort);
  }
}

export const edgeLogsRouter = {
  query: orgScopedProcedure.edgeLogs.query.handler(
    async ({ input, context }) => {
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
          try: () =>
            db.selectDistinct({ host: edgeLog.host }).from(edgeLog).limit(50),
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
            error:
              res.error instanceof Error
                ? res.error.message
                : String(res.error),
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
    },
  ),

  tail: orgScopedProcedure.edgeLogs.tail.handler(async function* ({
    input,
    context,
    signal,
  }) {
    const orgId = context.activeOrganizationId;
    const hosts = new Set(await resolveHosts(orgId, input.projectId));
    const upstreams = await listRouteUpstreams(
      orgId,
      input.projectId as ProjectId | undefined,
    );
    for await (const line of streamEdgeLogs(hosts, input.host, signal)) {
      yield {
        ...line,
        upstream: line.upstream ?? upstreams[line.host] ?? null,
      };
    }
  }),
};
