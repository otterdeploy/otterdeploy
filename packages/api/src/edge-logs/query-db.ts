/**
 * DB-backed edge-log query (Phase 2). Pulls matching rows from the edge_log
 * table for the requested window/filters, then reuses summarizeEdgeLogs so
 * the histogram + per-host percentiles are computed identically to the
 * in-memory path. Fetch is capped at MAX_FETCH most-recent rows; stats over
 * very high volume are therefore over that recent slice (exact at low/medium
 * volume). Moving the aggregates into SQL (percentile_cont) is the next step
 * if volume demands it.
 */

import type { SQL } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { edgeLog } from "@otterdeploy/db/schema/edge-log";
import { and, desc, gte, inArray, lt, or, ilike, sql } from "drizzle-orm";

import type { EdgeLogFilter, EdgeLogLine, EdgeLogQueryResult } from "./types";

import { RANGE_MS, summarizeEdgeLogs } from "./ring";

const MAX_FETCH = 10_000;

const STATUS_RANGE: Record<string, [number, number]> = {
  "2xx": [200, 300],
  "3xx": [300, 400],
  "4xx": [400, 500],
  "5xx": [500, 600],
};

function statusCondition(statuses: NonNullable<EdgeLogFilter["statuses"]>): SQL | undefined {
  const ranges: SQL[] = [];
  for (const s of statuses) {
    const range = STATUS_RANGE[s];
    if (!range) continue;
    const cond = and(gte(edgeLog.status, range[0]), lt(edgeLog.status, range[1]));
    if (cond) ranges.push(cond);
  }
  return ranges.length === 1 ? ranges[0] : or(...ranges);
}

function searchCondition(search: string): SQL | undefined {
  const like = `%${search}%`;
  return or(ilike(edgeLog.path, like), ilike(edgeLog.clientIp, like), ilike(edgeLog.method, like));
}

function buildConditions(filter: EdgeLogFilter, now: number): SQL[] {
  const since = new Date(now - RANGE_MS[filter.range]);
  // Compare on lower(host): scope hosts are canonicalized (edge-logs/host) and
  // new rows store a canonical host, but rows written before that change may
  // carry mixed-case hosts — lower() lets them match without a backfill.
  const scopeHost = sql`lower(${edgeLog.host})`;
  const conds: SQL[] = [inArray(scopeHost, filter.hosts), gte(edgeLog.ts, since)];
  if (filter.selectedHosts?.length) conds.push(inArray(scopeHost, filter.selectedHosts));
  if (filter.methods?.length) conds.push(inArray(edgeLog.method, filter.methods));
  if (filter.statuses?.length) {
    const cond = statusCondition(filter.statuses);
    if (cond) conds.push(cond);
  }
  if (filter.search) {
    const cond = searchCondition(filter.search);
    if (cond) conds.push(cond);
  }
  return conds;
}

export async function queryEdgeLogsDb(
  filter: EdgeLogFilter,
  now: number,
): Promise<EdgeLogQueryResult> {
  if (filter.hosts.length === 0) {
    return { rows: [], histogram: [], hostStats: [], total: 0 };
  }

  const conds = buildConditions(filter, now);

  const records = await db
    .select()
    .from(edgeLog)
    .where(and(...conds))
    .orderBy(desc(edgeLog.ts))
    .limit(MAX_FETCH);

  // summarize expects ascending order (it slices the newest tail).
  const lines: EdgeLogLine[] = records.reverse().map(rowToLine);
  return summarizeEdgeLogs(lines, filter.range, now, filter.limit ?? 200);
}

function rowToLine(r: typeof edgeLog.$inferSelect): EdgeLogLine {
  return {
    id: String(r.id),
    ts: r.ts.toISOString(),
    method: r.method,
    host: r.host,
    path: r.path,
    status: r.status,
    latencyMs: r.latencyMs,
    clientIp: r.clientIp,
    country: r.country,
    userAgent: r.userAgent,
    referer: r.referer,
    tlsVersion: r.tlsVersion,
    tlsCipher: r.tlsCipher,
    upstream: r.upstream,
    cache: r.cache,
    reqBytes: r.reqBytes,
    resBytes: r.resBytes,
    requestId: r.requestId,
    headers: r.headers,
  };
}
