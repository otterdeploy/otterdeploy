/**
 * Visitor trail: one visitor's sessions for the current UTC day, each with
 * its events in order. A UTC day because the visitor hash itself rotates at
 * UTC midnight — yesterday's hash is a different visitor by construction, so
 * a longer trail cannot exist. Capped so a runaway session can't flood the
 * dialog.
 */

import type { AnalyticsSessionId, AnalyticsSiteId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

import { db } from "@otterdeploy/db";
import { analyticsSession } from "@otterdeploy/db/schema/analytics";
import { analyticsEvent } from "@otterdeploy/db/schema/analytics-event";
import { Temporal } from "@otterdeploy/shared/temporal";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";

const EVENT_LIMIT = 500;
const SESSION_LIMIT = 50;

export interface VisitorTrailEvent {
  ts: string;
  kind: string;
  name: string | null;
  path: string;
  props: JsonObject | null;
}

export interface VisitorTrailSession {
  sessionId: AnalyticsSessionId;
  siteId: AnalyticsSiteId;
  startedAt: string;
  lastAt: string;
  pageviews: number;
  events: number;
  activeMs: number;
  scroll: number | null;
  entryPath: string;
  exitPath: string;
  host: string;
  referrerHost: string | null;
  country: string | null;
  browser: string;
  os: string;
  device: string;
  eventsList: VisitorTrailEvent[];
}

export async function visitorTrail(input: {
  siteIds: readonly AnalyticsSiteId[];
  visitorId: string;
  now: number;
}): Promise<{ sessions: VisitorTrailSession[] }> {
  if (input.siteIds.length === 0) return { sessions: [] };

  const dayStartMs = Temporal.Instant.fromEpochMilliseconds(input.now)
    .toZonedDateTimeISO("UTC")
    .startOfDay().epochMilliseconds;
  const dayStartIso = Temporal.Instant.fromEpochMilliseconds(dayStartMs).toString();

  const sessions = await db
    .select()
    .from(analyticsSession)
    .where(
      and(
        inArray(analyticsSession.siteId, [...input.siteIds]),
        eq(analyticsSession.visitorId, input.visitorId),
        gte(analyticsSession.lastAt, sql`${dayStartIso}::timestamptz`),
      ),
    )
    .orderBy(asc(analyticsSession.startedAt))
    .limit(SESSION_LIMIT)
    .$withCache(false);

  if (sessions.length === 0) return { sessions: [] };

  const events = await db
    .select({
      sessionId: analyticsEvent.sessionId,
      ts: analyticsEvent.ts,
      kind: analyticsEvent.kind,
      name: analyticsEvent.name,
      path: analyticsEvent.path,
      props: analyticsEvent.props,
    })
    .from(analyticsEvent)
    .where(
      and(
        inArray(analyticsEvent.siteId, [...input.siteIds]),
        inArray(
          analyticsEvent.sessionId,
          sessions.map((s) => s.id),
        ),
      ),
    )
    .orderBy(asc(analyticsEvent.ts))
    .limit(EVENT_LIMIT)
    .$withCache(false);

  const bySession = new Map<AnalyticsSessionId, VisitorTrailEvent[]>();
  for (const e of events) {
    const list = bySession.get(e.sessionId) ?? [];
    list.push({
      ts: e.ts.toISOString(),
      kind: e.kind,
      name: e.name,
      path: e.path,
      props: e.props,
    });
    bySession.set(e.sessionId, list);
  }

  return {
    sessions: sessions.map((s) => ({
      sessionId: s.id,
      siteId: s.siteId,
      startedAt: s.startedAt.toISOString(),
      lastAt: s.lastAt.toISOString(),
      pageviews: s.pageviews,
      events: s.events,
      activeMs: s.activeMs,
      scroll: s.scroll,
      entryPath: s.entryPath,
      exitPath: s.exitPath,
      host: s.host,
      referrerHost: s.referrerHost,
      country: s.country,
      browser: s.browser,
      os: s.os,
      device: s.device,
      eventsList: bySession.get(s.id) ?? [],
    })),
  };
}
