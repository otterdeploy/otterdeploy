/**
 * The sessionizer's DB seam: the shape of an open session, its mapping to
 * an `analytics_session` row, and the restart-survival lookup. Kept apart
 * from sessionizer.ts so the state machine stays free of drizzle and the
 * lookup can be swapped for a fake in tests.
 */

import type { NewAnalyticsSessionRow } from "@otterdeploy/db/schema/analytics";
import type { AnalyticsSessionId, AnalyticsSiteId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { analyticsSession } from "@otterdeploy/db/schema/analytics";
import { and, desc, eq, gt } from "drizzle-orm";

export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_MAX_MS = 24 * 60 * 60_000;

/** Dimensions frozen on the session at first touch (design §4.4). */
export interface SessionDimensions {
  host: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  country: string | null;
  browser: string;
  os: string;
  device: string;
  screenW: number | null;
  language: string | null;
}

export interface OpenSession extends SessionDimensions {
  id: AnalyticsSessionId;
  siteId: AnalyticsSiteId;
  visitorId: string;
  externalUserId: string | null;
  startedAt: number;
  lastAt: number;
  pageviews: number;
  events: number;
  activeMs: number;
  scroll: number | null;
  entryPath: string;
  exitPath: string;
  /** Changed since the last `takeDirtySessions()`. */
  dirty: boolean;
}

/** The dimension fields alone, copied out of anything that carries them
 *  (an open session, a session row) — the one list every row shape that
 *  stores first-touch attribution is built from. */
export function pickDimensions(s: SessionDimensions): SessionDimensions {
  return {
    host: s.host,
    referrerHost: s.referrerHost,
    utmSource: s.utmSource,
    utmMedium: s.utmMedium,
    utmCampaign: s.utmCampaign,
    utmTerm: s.utmTerm,
    utmContent: s.utmContent,
    country: s.country,
    browser: s.browser,
    os: s.os,
    device: s.device,
    screenW: s.screenW,
    language: s.language,
  };
}

/** `Date` only at the drizzle seam (timestamp columns take one). */
function toDate(epochMs: number): Date {
  return new Date(epochMs);
}

export function toSessionRow(s: OpenSession): NewAnalyticsSessionRow {
  return {
    id: s.id,
    siteId: s.siteId,
    visitorId: s.visitorId,
    externalUserId: s.externalUserId,
    startedAt: toDate(s.startedAt),
    lastAt: toDate(s.lastAt),
    pageviews: s.pageviews,
    events: s.events,
    activeMs: s.activeMs,
    scroll: s.scroll,
    entryPath: s.entryPath,
    exitPath: s.exitPath,
    ...pickDimensions(s),
  };
}

export type LookupOpenSession = (
  siteId: AnalyticsSiteId,
  visitorId: string,
  now: number,
) => Promise<OpenSession | null>;

/** Most recent session for (site, visitor) still inside the idle window, so a
 *  restarted collector continues a visit instead of splitting it. */
export const lookupOpenSessionDb: LookupOpenSession = async (siteId, visitorId, now) => {
  const [row] = await db
    .select()
    .from(analyticsSession)
    .where(
      and(
        eq(analyticsSession.siteId, siteId),
        eq(analyticsSession.visitorId, visitorId),
        gt(analyticsSession.lastAt, toDate(now - SESSION_IDLE_MS)),
      ),
    )
    .orderBy(desc(analyticsSession.lastAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    siteId: row.siteId,
    visitorId: row.visitorId,
    externalUserId: row.externalUserId,
    startedAt: row.startedAt.getTime(),
    lastAt: row.lastAt.getTime(),
    pageviews: row.pageviews,
    events: row.events,
    activeMs: row.activeMs,
    scroll: row.scroll,
    entryPath: row.entryPath,
    exitPath: row.exitPath,
    ...pickDimensions(row),
    dirty: false,
  };
};
