/**
 * Breakdown reader: one dimension grouped over the window, ordered by
 * distinct visitors. Event-carried dimensions group the event stream;
 * entry/exit paths group sessions (bringing bounce + duration per row);
 * `event` lists custom events by name and `goal` only conversion-flagged
 * definitions, with a conversion rate against the window's total visitors.
 * `share` is each row's visitors over that same total.
 */

import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { analyticsSession } from "@otterdeploy/db/schema/analytics";
import { analyticsEvent } from "@otterdeploy/db/schema/analytics-event";
import { sql, type SQL } from "drizzle-orm";
import * as z from "zod";

import {
  type AnalyticsFilter,
  applyFilters,
  type BreakdownDimension,
  DIRECT_KEY,
  eventDimensionExpr,
  NONE_KEY,
  sessionDimensionExpr,
} from "./filters";
import { executeRows, siteIdIn, tsRange } from "./sql-utils";
import { type ResolvedWindow } from "./window";

export const BREAKDOWN_MAX_LIMIT = 500;

export interface BreakdownRow {
  key: string;
  visitors: number;
  pageviews?: number;
  sessions?: number;
  events?: number;
  bounceRate?: number | null;
  avgDurationMs?: number | null;
  conversions?: number;
  conversionRate?: number;
  /** visitors / window total visitors, 0..1 (0 when the window is empty). */
  share: number;
}

const groupedRow = z.object({
  key: z.string().nullable(),
  visitors: z.coerce.number(),
  a: z.coerce.number().nullable(),
  b: z.coerce.number().nullable(),
  c: z.coerce.number().nullable(),
});

const totalRow = z.object({ total: z.coerce.number() });

function keyOf(raw: string | null, dimension: BreakdownDimension): string {
  if (raw !== null && raw !== "") return raw;
  return dimension === "referrer" ? DIRECT_KEY : NONE_KEY;
}

function withFilters(base: SQL, extra: SQL | undefined): SQL {
  return extra ? sql`${base} AND ${extra}` : base;
}

interface QueryInput {
  siteIds: readonly AnalyticsSiteId[];
  window: ResolvedWindow;
  filters: readonly AnalyticsFilter[];
  dimension: BreakdownDimension;
  limit: number;
  offset: number;
}

function eventScope(input: QueryInput): SQL {
  return withFilters(
    sql`${siteIdIn(sql`${analyticsEvent.siteId}`, input.siteIds)} AND ${tsRange(sql`${analyticsEvent.ts}`, input.window.from, input.window.to)}`,
    applyFilters({ target: "event", filters: input.filters }),
  );
}

/** SELECT key, visitors, a, b, c … with the shared order/page clause. */
function page(input: QueryInput): SQL {
  // Contract-capped; clamp anyway so a direct caller can't unbound the scan.
  const limit = Math.min(input.limit, BREAKDOWN_MAX_LIMIT);
  return sql`ORDER BY visitors DESC, key ASC NULLS LAST LIMIT ${limit + 1} OFFSET ${input.offset}`;
}

async function groupedEvents(input: QueryInput, expr: SQL): Promise<z.infer<typeof groupedRow>[]> {
  const pageviewOnly =
    input.dimension === "path" ? sql` AND ${analyticsEvent.kind} = 'pageview'` : sql``;
  const res = await db.execute(sql`
    SELECT ${expr} AS key,
      count(DISTINCT ${analyticsEvent.visitorId})::float8 AS visitors,
      count(*) FILTER (WHERE ${analyticsEvent.kind} = 'pageview')::float8 AS a,
      NULL::float8 AS b, NULL::float8 AS c
    FROM analytics_event WHERE ${eventScope(input)}${pageviewOnly}
    GROUP BY 1 ${page(input)}
  `);
  return executeRows(res).flatMap((raw) => {
    const row = groupedRow.safeParse(raw);
    return row.success ? [row.data] : [];
  });
}

async function groupedSessions(
  input: QueryInput,
  expr: SQL,
): Promise<z.infer<typeof groupedRow>[]> {
  const scope = withFilters(
    sql`${siteIdIn(sql`${analyticsSession.siteId}`, input.siteIds)} AND ${tsRange(sql`${analyticsSession.startedAt}`, input.window.from, input.window.to)}`,
    applyFilters({ target: "session", filters: input.filters }),
  );
  const res = await db.execute(sql`
    SELECT ${expr} AS key,
      count(DISTINCT ${analyticsSession.visitorId})::float8 AS visitors,
      count(*)::float8 AS a,
      count(*) FILTER (WHERE NOT (${analyticsSession.pageviews} >= 2 OR ${analyticsSession.events} > 0 OR ${analyticsSession.activeMs} >= 10000))::float8 AS b,
      (avg(extract(epoch FROM (${analyticsSession.lastAt} - ${analyticsSession.startedAt}))) * 1000)::float8 AS c
    FROM analytics_session WHERE ${scope}
    GROUP BY 1 ${page(input)}
  `);
  return executeRows(res).flatMap((raw) => {
    const row = groupedRow.safeParse(raw);
    return row.success ? [row.data] : [];
  });
}

async function groupedNames(
  input: QueryInput,
  goalsOnly: boolean,
): Promise<z.infer<typeof groupedRow>[]> {
  const goalJoin = goalsOnly
    ? sql`JOIN analytics_event_definition d ON d.site_id = ${analyticsEvent.siteId} AND d.name = ${analyticsEvent.name} AND d.conversion AND d.archived_at IS NULL`
    : sql``;
  const res = await db.execute(sql`
    SELECT ${analyticsEvent.name} AS key,
      count(DISTINCT ${analyticsEvent.visitorId})::float8 AS visitors,
      count(*)::float8 AS a, NULL::float8 AS b, NULL::float8 AS c
    FROM analytics_event ${goalJoin}
    WHERE ${eventScope(input)} AND ${analyticsEvent.kind} = 'event' AND ${analyticsEvent.name} IS NOT NULL
    GROUP BY 1 ${page(input)}
  `);
  return executeRows(res).flatMap((raw) => {
    const row = groupedRow.safeParse(raw);
    return row.success ? [row.data] : [];
  });
}

/** Distinct visitors over the whole (filtered) window: the `share` and
 *  conversion-rate denominator. */
async function totalVisitors(input: QueryInput): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(DISTINCT ${analyticsEvent.visitorId})::float8 AS total
    FROM analytics_event WHERE ${eventScope(input)}
  `);
  return totalRow.parse(executeRows(res)[0] ?? { total: 0 }).total;
}

export async function breakdownQuery(input: QueryInput): Promise<{
  dimension: BreakdownDimension;
  rows: BreakdownRow[];
  total: number;
  hasMore: boolean;
}> {
  const { dimension } = input;
  if (input.siteIds.length === 0) return { dimension, rows: [], total: 0, hasMore: false };

  const sessionExpr = dimension === "entryPath" || dimension === "exitPath";
  let grouped: z.infer<typeof groupedRow>[];
  if (dimension === "event" || dimension === "goal") {
    grouped = await groupedNames(input, dimension === "goal");
  } else if (sessionExpr) {
    grouped = await groupedSessions(input, sessionDimensionExpr(dimension) ?? sql`NULL`);
  } else {
    grouped = await groupedEvents(input, eventDimensionExpr(dimension) ?? sql`NULL`);
  }
  const total = await totalVisitors(input);

  const limit = Math.min(input.limit, BREAKDOWN_MAX_LIMIT);
  const hasMore = grouped.length > limit;
  const rows = grouped.slice(0, limit).map((r): BreakdownRow => {
    const base: BreakdownRow = {
      key: keyOf(r.key, dimension),
      visitors: r.visitors,
      share: total > 0 ? r.visitors / total : 0,
    };
    if (sessionExpr) {
      const sessions = r.a ?? 0;
      base.sessions = sessions;
      base.bounceRate = sessions > 0 ? (r.b ?? 0) / sessions : null;
      base.avgDurationMs = sessions > 0 ? r.c : null;
    } else if (dimension === "event") {
      base.events = r.a ?? 0;
    } else if (dimension === "goal") {
      base.events = r.a ?? 0;
      base.conversions = r.visitors;
      base.conversionRate = total > 0 ? r.visitors / total : 0;
    } else {
      base.pageviews = r.a ?? 0;
    }
    return base;
  });

  return { dimension, rows, total, hasMore };
}
