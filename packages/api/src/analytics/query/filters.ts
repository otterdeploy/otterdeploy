/**
 * Filter compilation for the analytics query API: a `{dim, op, value}` triple
 * becomes a drizzle SQL fragment against either the event stream or the
 * session table. Every dimension lives naturally on one of the two; a filter
 * applied to the OTHER target is bridged with a correlated EXISTS (an
 * event-level filter on session metrics = "sessions containing such an
 * event", and vice versa). Values are always bound parameters.
 */

import { analyticsSession } from "@otterdeploy/db/schema/analytics";
import { analyticsEvent } from "@otterdeploy/db/schema/analytics-event";
import { and, sql, type SQL } from "drizzle-orm";

import { channelCase } from "./channel-sql";

export const FILTER_DIMENSIONS = [
  "path",
  "entryPath",
  "exitPath",
  "host",
  "referrer",
  "channel",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "country",
  "device",
  "browser",
  "os",
  "language",
  "event",
  "screen",
] as const;

export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];

export const FILTER_OPS = ["is", "isNot", "contains"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Everything filterable is also breakdownable, plus `goal` (conversion
 *  definitions only). Lives here — not in breakdown.ts — so the oRPC contract
 *  can import the vocabulary without touching the db client. */
export const BREAKDOWN_DIMENSIONS = [...FILTER_DIMENSIONS, "goal"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export interface AnalyticsFilter {
  dim: FilterDimension;
  op: FilterOp;
  value: string;
}

/** How a null key renders in breakdowns — and, symmetrically, the filter
 *  values that compile back to an IS NULL check. */
export const NONE_KEY = "(none)";
export const DIRECT_KEY = "Direct / none";

/** Postgres LIKE/ILIKE special characters, escaped with the default `\`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export const SCREEN_BUCKETS = ["Mobile", "Tablet", "Laptop", "Desktop", "Unknown"] as const;

/** Bucketed screen width. Never null: unknown widths get an honest label. */
export function screenCase(screenW: SQL | SQL.Aliased): SQL {
  return sql`(CASE WHEN ${screenW} IS NULL THEN 'Unknown' WHEN ${screenW} < 576 THEN 'Mobile' WHEN ${screenW} < 992 THEN 'Tablet' WHEN ${screenW} < 1440 THEN 'Laptop' ELSE 'Desktop' END)`;
}

type Dims = typeof analyticsEvent | typeof analyticsSession;

/** Attribution dimensions both tables carry, resolved off `t`'s columns. */
function attributionExpr(t: Dims, dim: FilterDimension): SQL | null {
  switch (dim) {
    case "host":
      return sql`${t.host}`;
    case "referrer":
      return sql`${t.referrerHost}`;
    case "channel":
      return channelCase({
        referrerHost: sql`${t.referrerHost}`,
        utmSource: sql`${t.utmSource}`,
        utmMedium: sql`${t.utmMedium}`,
      });
    case "utmSource":
      return sql`${t.utmSource}`;
    case "utmMedium":
      return sql`${t.utmMedium}`;
    case "utmCampaign":
      return sql`${t.utmCampaign}`;
    case "utmTerm":
      return sql`${t.utmTerm}`;
    case "utmContent":
      return sql`${t.utmContent}`;
    case "country":
      return sql`${t.country}`;
    case "device":
      return sql`${t.device}`;
    case "browser":
      return sql`${t.browser}`;
    case "os":
      return sql`${t.os}`;
    case "language":
      return sql`${t.language}`;
    case "screen":
      return screenCase(sql`${t.screenW}`);
    default:
      return null;
  }
}

/** Event-row expression for a dimension; null when it lives on the session. */
export function eventDimensionExpr(dim: FilterDimension): SQL | null {
  if (dim === "path") return sql`${analyticsEvent.path}`;
  if (dim === "event") return sql`${analyticsEvent.name}`;
  return attributionExpr(analyticsEvent, dim);
}

/** Session-row expression for a dimension; null when it lives on events. */
export function sessionDimensionExpr(dim: FilterDimension): SQL | null {
  if (dim === "entryPath") return sql`${analyticsSession.entryPath}`;
  if (dim === "exitPath") return sql`${analyticsSession.exitPath}`;
  if (dim === "path" || dim === "event") return null;
  return attributionExpr(analyticsSession, dim);
}

/** The one op-application point. `(none)` / `Direct / none` compile to null
 *  checks so a breakdown row's key round-trips as a filter. */
export function comparison(expr: SQL, op: FilterOp, value: string): SQL {
  const none = value === NONE_KEY || value === DIRECT_KEY;
  switch (op) {
    case "is":
      return none ? sql`${expr} IS NULL` : sql`${expr} = ${value}`;
    case "isNot":
      // IS DISTINCT FROM: a null referrer IS "not google.com".
      return none ? sql`${expr} IS NOT NULL` : sql`${expr} IS DISTINCT FROM ${value}`;
    case "contains":
      return sql`${expr} ILIKE ${`%${escapeLike(value)}%`}`;
  }
}

/** Direct event-row predicates for filters whose dimension the event carries. */
export function eventWhere(filters: readonly AnalyticsFilter[]): SQL | undefined {
  const parts: SQL[] = [];
  for (const f of filters) {
    const expr = eventDimensionExpr(f.dim);
    if (expr) parts.push(comparison(expr, f.op, f.value));
  }
  return and(...parts);
}

/** Direct session-row predicates for filters the session row carries. */
export function sessionWhere(filters: readonly AnalyticsFilter[]): SQL | undefined {
  const parts: SQL[] = [];
  for (const f of filters) {
    const expr = sessionDimensionExpr(f.dim);
    if (expr) parts.push(comparison(expr, f.op, f.value));
  }
  return and(...parts);
}

/** "The session contains a matching event." `isNot` inverts the EXISTS
 *  (a session that never did X), not the row predicate. `kindGuard` narrows
 *  to pageviews (path filters) or custom events (event filters). */
function sessionHasEvent(
  sessionId: SQL,
  siteId: SQL,
  column: string,
  f: AnalyticsFilter,
  kindGuard: string,
): SQL {
  // Static identifiers from our own closed column set — never user input.
  const col = sql.raw(`ae.${column}`);
  const pred = comparison(sql`${col}`, f.op === "isNot" ? "is" : f.op, f.value);
  const exists = sql`EXISTS (SELECT 1 FROM analytics_event ae WHERE ae.site_id = ${siteId} AND ae.session_id = ${sessionId} AND ae.kind = ${kindGuard} AND ${pred})`;
  return f.op === "isNot" ? sql`NOT ${exists}` : exists;
}

/** "The event's session matches." One session per event, so the predicate
 *  (including `isNot`) applies inside the EXISTS unchanged. */
function eventSessionMatches(f: AnalyticsFilter): SQL {
  const expr = sessionDimensionExpr(f.dim);
  const pred = expr ? comparison(expr, f.op, f.value) : sql`true`;
  return sql`EXISTS (SELECT 1 FROM analytics_session WHERE ${analyticsSession.id} = ${analyticsEvent.sessionId} AND ${pred})`;
}

/**
 * Compose the full WHERE for a filter set against one target:
 * - target "event": event dims direct; entry/exit paths via the session;
 *   `event` means "by a session that triggered it" (session-scoped, the
 *   useful reading for "pageviews by converters").
 * - target "session": session dims direct; `path` = "visited that page",
 *   `event` = "triggered that event".
 */
export function applyFilters(input: {
  target: "event" | "session";
  filters: readonly AnalyticsFilter[];
}): SQL | undefined {
  const parts: SQL[] = [];
  for (const f of input.filters) {
    if (input.target === "event") {
      if (f.dim === "entryPath" || f.dim === "exitPath") {
        parts.push(eventSessionMatches(f));
      } else if (f.dim === "event") {
        parts.push(
          sessionHasEvent(
            sql`${analyticsEvent.sessionId}`,
            sql`${analyticsEvent.siteId}`,
            "name",
            f,
            "event",
          ),
        );
      } else {
        const expr = eventDimensionExpr(f.dim);
        if (expr) parts.push(comparison(expr, f.op, f.value));
      }
    } else if (f.dim === "path") {
      parts.push(
        sessionHasEvent(
          sql`${analyticsSession.id}`,
          sql`${analyticsSession.siteId}`,
          "path",
          f,
          "pageview",
        ),
      );
    } else if (f.dim === "event") {
      parts.push(
        sessionHasEvent(
          sql`${analyticsSession.id}`,
          sql`${analyticsSession.siteId}`,
          "name",
          f,
          "event",
        ),
      );
    } else {
      const expr = sessionDimensionExpr(f.dim);
      if (expr) parts.push(comparison(expr, f.op, f.value));
    }
  }
  return and(...parts);
}
