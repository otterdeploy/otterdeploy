/**
 * Overview reader: whole-window totals + a zero-filled time series, straight
 * off the raw event stream and the session table (no rollups in Phase 1 —
 * partition pruning + the (site_id, ts) index keep 90-day windows cheap).
 * Bounce/duration/views-per-visit come from sessions; visitors/pageviews/
 * conversions from events; the two halves share the same filter set applied
 * to their own target. Design: docs/designs/web-analytics.md §6.
 */

import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { analyticsSession } from "@otterdeploy/db/schema/analytics";
import { analyticsEvent } from "@otterdeploy/db/schema/analytics-event";
import { sql, type SQL } from "drizzle-orm";
import * as z from "zod";

import { type AnalyticsFilter, applyFilters } from "./filters";
import { bucketMsExpr, executeRows, isoOf, siteIdIn, tsRange } from "./sql-utils";
import { type Bucket, bucketStarts, type ResolvedWindow } from "./window";

export interface OverviewTotals {
  visitors: number;
  pageviews: number;
  sessions: number;
  /** bounced / sessions, 0..1; null when the window has no sessions. */
  bounceRate: number | null;
  avgDurationMs: number | null;
  viewsPerVisit: number | null;
  /** Distinct visitors who triggered a conversion-flagged event. */
  conversions: number;
}

export interface OverviewSeriesPoint {
  /** ISO instant of the bucket start (converted back from the tz cut). */
  t: string;
  visitors: number;
  pageviews: number;
  sessions: number;
}

const eventTotalsRow = z.object({
  visitors: z.coerce.number(),
  pageviews: z.coerce.number(),
  conversions: z.coerce.number(),
});

const sessionTotalsRow = z.object({
  sessions: z.coerce.number(),
  bounced: z.coerce.number(),
  avg_duration_ms: z.coerce.number().nullable(),
});

const seriesRow = z.object({
  t_ms: z.coerce.number(),
  a: z.coerce.number(),
  b: z.coerce.number(),
});

/** The session-side bounce rule (Open's): NOT engaged. */
const NOT_ENGAGED = sql`NOT (${analyticsSession.pageviews} >= 2 OR ${analyticsSession.events} > 0 OR ${analyticsSession.activeMs} >= 10000)`;

/** "This event's name is a conversion goal for its site." */
const IS_CONVERSION = sql`EXISTS (SELECT 1 FROM analytics_event_definition d WHERE d.site_id = ${analyticsEvent.siteId} AND d.name = ${analyticsEvent.name} AND d.conversion AND d.archived_at IS NULL)`;

function withFilters(base: SQL, extra: SQL | undefined): SQL {
  return extra ? sql`${base} AND ${extra}` : base;
}

async function totalsFor(
  siteIds: readonly AnalyticsSiteId[],
  from: number,
  to: number,
  filters: readonly AnalyticsFilter[],
): Promise<OverviewTotals> {
  const eventScope = withFilters(
    sql`${siteIdIn(sql`${analyticsEvent.siteId}`, siteIds)} AND ${tsRange(sql`${analyticsEvent.ts}`, from, to)}`,
    applyFilters({ target: "event", filters }),
  );
  const sessionScope = withFilters(
    sql`${siteIdIn(sql`${analyticsSession.siteId}`, siteIds)} AND ${tsRange(sql`${analyticsSession.startedAt}`, from, to)}`,
    applyFilters({ target: "session", filters }),
  );

  const [eventRes, sessionRes] = await Promise.all([
    db.execute(sql`
      SELECT count(DISTINCT ${analyticsEvent.visitorId})::float8 AS visitors,
        count(*) FILTER (WHERE ${analyticsEvent.kind} = 'pageview')::float8 AS pageviews,
        count(DISTINCT ${analyticsEvent.visitorId}) FILTER (WHERE ${analyticsEvent.kind} = 'event' AND ${IS_CONVERSION})::float8 AS conversions
      FROM analytics_event WHERE ${eventScope}
    `),
    db.execute(sql`
      SELECT count(*)::float8 AS sessions,
        count(*) FILTER (WHERE ${NOT_ENGAGED})::float8 AS bounced,
        (avg(extract(epoch FROM (${analyticsSession.lastAt} - ${analyticsSession.startedAt}))) * 1000)::float8 AS avg_duration_ms
      FROM analytics_session WHERE ${sessionScope}
    `),
  ]);

  const events = eventTotalsRow.parse(executeRows(eventRes)[0] ?? {});
  const sessions = sessionTotalsRow.parse(executeRows(sessionRes)[0] ?? {});
  const hasSessions = sessions.sessions > 0;
  return {
    visitors: events.visitors,
    pageviews: events.pageviews,
    sessions: sessions.sessions,
    bounceRate: hasSessions ? sessions.bounced / sessions.sessions : null,
    avgDurationMs: hasSessions ? sessions.avg_duration_ms : null,
    viewsPerVisit: hasSessions ? events.pageviews / sessions.sessions : null,
    conversions: events.conversions,
  };
}

export function emptyTotals(): OverviewTotals {
  return {
    visitors: 0,
    pageviews: 0,
    sessions: 0,
    bounceRate: null,
    avgDurationMs: null,
    viewsPerVisit: null,
    conversions: 0,
  };
}

async function seriesFor(
  siteIds: readonly AnalyticsSiteId[],
  window: ResolvedWindow,
  tz: string,
  filters: readonly AnalyticsFilter[],
  now: number,
): Promise<OverviewSeriesPoint[]> {
  const bucket = window.bucket;
  const points = new Map<number, OverviewSeriesPoint>();
  for (const ms of bucketStarts(window.from, window.to, bucket, tz, now)) {
    points.set(ms, { t: isoOf(ms), visitors: 0, pageviews: 0, sessions: 0 });
  }
  const at = (ms: number): OverviewSeriesPoint => {
    let p = points.get(ms);
    if (!p) {
      // A DST fold can produce a bucket JS didn't enumerate; keep it honest.
      p = { t: isoOf(ms), visitors: 0, pageviews: 0, sessions: 0 };
      points.set(ms, p);
    }
    return p;
  };

  const eventScope = withFilters(
    sql`${siteIdIn(sql`${analyticsEvent.siteId}`, siteIds)} AND ${tsRange(sql`${analyticsEvent.ts}`, window.from, window.to)}`,
    applyFilters({ target: "event", filters }),
  );
  const sessionScope = withFilters(
    sql`${siteIdIn(sql`${analyticsSession.siteId}`, siteIds)} AND ${tsRange(sql`${analyticsSession.startedAt}`, window.from, window.to)}`,
    applyFilters({ target: "session", filters }),
  );

  const [eventRes, sessionRes] = await Promise.all([
    db.execute(sql`
      SELECT ${bucketMsExpr(sql`${analyticsEvent.ts}`, bucket, tz)} AS t_ms,
        count(DISTINCT ${analyticsEvent.visitorId})::float8 AS a,
        count(*) FILTER (WHERE ${analyticsEvent.kind} = 'pageview')::float8 AS b
      FROM analytics_event WHERE ${eventScope} GROUP BY 1
    `),
    db.execute(sql`
      SELECT ${bucketMsExpr(sql`${analyticsSession.startedAt}`, bucket, tz)} AS t_ms,
        count(*)::float8 AS a, 0::float8 AS b
      FROM analytics_session WHERE ${sessionScope} GROUP BY 1
    `),
  ]);

  for (const raw of executeRows(eventRes)) {
    const row = seriesRow.safeParse(raw);
    if (!row.success) continue;
    const p = at(row.data.t_ms);
    p.visitors = row.data.a;
    p.pageviews = row.data.b;
  }
  for (const raw of executeRows(sessionRes)) {
    const row = seriesRow.safeParse(raw);
    if (!row.success) continue;
    at(row.data.t_ms).sessions = row.data.a;
  }
  return [...points.entries()].sort((x, y) => x[0] - y[0]).map(([, p]) => p);
}

export async function overviewQuery(input: {
  siteIds: readonly AnalyticsSiteId[];
  window: ResolvedWindow;
  tz: string;
  filters: readonly AnalyticsFilter[];
  compare: boolean;
  now: number;
}): Promise<{
  totals: OverviewTotals;
  previous: OverviewTotals | null;
  series: OverviewSeriesPoint[];
  bucket: Bucket;
}> {
  const { siteIds, window, tz, filters, compare, now } = input;
  if (siteIds.length === 0) {
    // Honest zeros for an empty scope; the series still shows the window.
    return {
      totals: emptyTotals(),
      previous: compare ? emptyTotals() : null,
      series: bucketStarts(window.from, window.to, window.bucket, tz, now).map((ms) => ({
        t: isoOf(ms),
        visitors: 0,
        pageviews: 0,
        sessions: 0,
      })),
      bucket: window.bucket,
    };
  }
  const [totals, previous, series] = await Promise.all([
    totalsFor(siteIds, window.from, window.to, filters),
    compare
      ? totalsFor(siteIds, window.previous.from, window.previous.to, filters)
      : Promise.resolve(null),
    seriesFor(siteIds, window, tz, filters, now),
  ]);
  return { totals, previous, series, bucket: window.bucket };
}
