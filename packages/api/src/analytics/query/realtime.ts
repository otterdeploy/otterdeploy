/**
 * Realtime reader — DB-only, from `analytics_session` (owner decision
 * 2026-08-26: no in-memory presence store). A visitor is "live" when their
 * session saw activity inside the last five minutes; `path` is the session's
 * exit path (the last page the sessionizer saw them on). Honest trade-off:
 * liveness lags by the tracker's batching (~1 s flush) and never survives
 * longer than `last_at` updates do.
 */

import type { AnalyticsSessionId, AnalyticsSiteId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { analyticsSession } from "@otterdeploy/db/schema/analytics";
import { desc, gt, inArray, sql } from "drizzle-orm";
import * as z from "zod";

import { executeRows, isoOf, siteIdIn } from "./sql-utils";

export const REALTIME_WINDOW_MS = 5 * 60_000;
const RECENT_WINDOW_MS = 24 * 60 * 60_000;
const LIST_LIMIT = 50;
const BY_PATH_LIMIT = 20;

export interface RealtimeOnlineEntry {
  visitorId: string;
  sessionId: AnalyticsSessionId;
  /** The session's exit path: where the visitor was last seen. */
  path: string;
  host: string;
  country: string | null;
  browser: string;
  os: string;
  device: string;
  /** ISO instants (session started_at / last_at). */
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface RealtimeRecentSession {
  sessionId: AnalyticsSessionId;
  visitorId: string;
  startedAt: string;
  lastAt: string;
  pageviews: number;
  events: number;
  entryPath: string;
  exitPath: string;
  referrerHost: string | null;
  country: string | null;
  browser: string;
  os: string;
  device: string;
  live: boolean;
}

const countRow = z.object({ visitors: z.coerce.number() });
const pathRow = z.object({ path: z.string(), visitors: z.coerce.number() });

function liveCutoffExpr(now: number) {
  return sql`${analyticsSession.lastAt} > ${isoOf(now - REALTIME_WINDOW_MS)}::timestamptz`;
}

/** Distinct visitors active in the last five minutes. Visitor hashes are
 *  site-scoped, so counting across sites never double-counts. */
export async function liveVisitorCount(
  siteIds: readonly AnalyticsSiteId[],
  now: number,
): Promise<number> {
  if (siteIds.length === 0) return 0;
  const res = await db.execute(sql`
    SELECT count(DISTINCT ${analyticsSession.visitorId})::float8 AS visitors
    FROM analytics_session
    WHERE ${siteIdIn(sql`${analyticsSession.siteId}`, siteIds)} AND ${liveCutoffExpr(now)}
  `);
  return countRow.parse(executeRows(res)[0] ?? { visitors: 0 }).visitors;
}

async function liveByPath(
  siteIds: readonly AnalyticsSiteId[],
  now: number,
): Promise<Array<{ path: string; visitors: number }>> {
  const res = await db.execute(sql`
    SELECT ${analyticsSession.exitPath} AS path,
      count(DISTINCT ${analyticsSession.visitorId})::float8 AS visitors
    FROM analytics_session
    WHERE ${siteIdIn(sql`${analyticsSession.siteId}`, siteIds)} AND ${liveCutoffExpr(now)}
    GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT ${BY_PATH_LIMIT}
  `);
  return executeRows(res).flatMap((raw) => {
    const row = pathRow.safeParse(raw);
    return row.success ? [row.data] : [];
  });
}

export async function realtimeQuery(input: {
  siteIds: readonly AnalyticsSiteId[];
  now: number;
}): Promise<{
  liveVisitors: number;
  byPath: Array<{ path: string; visitors: number }>;
  online: RealtimeOnlineEntry[];
  recent: RealtimeRecentSession[];
}> {
  const { siteIds, now } = input;
  if (siteIds.length === 0) return { liveVisitors: 0, byPath: [], online: [], recent: [] };

  const liveCutoffMs = now - REALTIME_WINDOW_MS;
  const [liveVisitors, byPath, recentRows] = await Promise.all([
    liveVisitorCount(siteIds, now),
    liveByPath(siteIds, now),
    db
      .select()
      .from(analyticsSession)
      .where(
        sql`${inArray(analyticsSession.siteId, [...siteIds])} AND ${gt(
          analyticsSession.lastAt,
          sql`${isoOf(now - RECENT_WINDOW_MS)}::timestamptz`,
        )}`,
      )
      .orderBy(desc(analyticsSession.lastAt))
      .limit(LIST_LIMIT)
      .$withCache(false),
  ]);

  const recent = recentRows.map(
    (s): RealtimeRecentSession => ({
      sessionId: s.id,
      visitorId: s.visitorId,
      startedAt: s.startedAt.toISOString(),
      lastAt: s.lastAt.toISOString(),
      pageviews: s.pageviews,
      events: s.events,
      entryPath: s.entryPath,
      exitPath: s.exitPath,
      referrerHost: s.referrerHost,
      country: s.country,
      browser: s.browser,
      os: s.os,
      device: s.device,
      live: s.lastAt.getTime() > liveCutoffMs,
    }),
  );

  // The recent list is last_at-descending, so its live prefix IS the online
  // list — one query serves both, and the two views can never disagree.
  const online = recentRows
    .filter((s) => s.lastAt.getTime() > liveCutoffMs)
    .map(
      (s): RealtimeOnlineEntry => ({
        visitorId: s.visitorId,
        sessionId: s.id,
        path: s.exitPath,
        host: s.host,
        country: s.country,
        browser: s.browser,
        os: s.os,
        device: s.device,
        firstSeenAt: s.startedAt.toISOString(),
        lastSeenAt: s.lastAt.toISOString(),
      }),
    );

  return { liveVisitors, byPath, online, recent };
}
