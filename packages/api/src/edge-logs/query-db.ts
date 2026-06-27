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
import { and, desc, gte, inArray, lt, or, ilike } from "drizzle-orm";

import type { EdgeLogFilter, EdgeLogLine, EdgeLogQueryResult } from "./types";

import { RANGE_MS, summarizeEdgeLogs } from "./ring";

const MAX_FETCH = 10_000;

const STATUS_RANGE: Record<string, [number, number]> = {
  "2xx": [200, 300],
  "3xx": [300, 400],
  "4xx": [400, 500],
  "5xx": [500, 600],
};

export async function queryEdgeLogsDb(
  filter: EdgeLogFilter,
  now: number,
): Promise<EdgeLogQueryResult> {
  if (filter.hosts.length === 0) {
    return { rows: [], histogram: [], hostStats: [], total: 0 };
  }

  const since = new Date(now - RANGE_MS[filter.range]);
  const conds: SQL[] = [inArray(edgeLog.host, filter.hosts), gte(edgeLog.ts, since)];
  if (filter.selectedHosts?.length) conds.push(inArray(edgeLog.host, filter.selectedHosts));
  if (filter.methods?.length) conds.push(inArray(edgeLog.method, filter.methods));
  if (filter.statuses?.length) {
    const ranges = filter.statuses.map((s) => {
      const [lo, hi] = STATUS_RANGE[s]!;
      return and(gte(edgeLog.status, lo), lt(edgeLog.status, hi))!;
    });
    const combined = ranges.length === 1 ? ranges[0]! : or(...ranges);
    if (combined) conds.push(combined);
  }
  if (filter.search) {
    const like = `%${filter.search}%`;
    const m = or(
      ilike(edgeLog.path, like),
      ilike(edgeLog.clientIp, like),
      ilike(edgeLog.method, like),
    );
    if (m) conds.push(m);
  }

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
