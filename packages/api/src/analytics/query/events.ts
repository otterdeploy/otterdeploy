/**
 * Event-definition management: the auto-registered catalogue of custom event
 * names, listed with their in-window counts (a definition with zero events in
 * the window still lists — it exists, it's just quiet), plus the owner-set
 * bits (display name, conversion flag, archive). All writes are scoped to the
 * caller's resolved sites, so a foreign id updates nothing and returns null.
 */

import type { AnalyticsEventDefinitionId, AnalyticsSiteId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { analyticsEventDefinition } from "@otterdeploy/db/schema/analytics";
import { analyticsEvent } from "@otterdeploy/db/schema/analytics-event";
import { omitUndefined } from "@otterdeploy/shared/object";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";

import { type AnalyticsFilter, applyFilters } from "./filters";
import { executeRows, siteIdIn, tsRange } from "./sql-utils";
import { type ResolvedWindow } from "./window";

export interface EventDefinitionListing {
  id: AnalyticsEventDefinitionId;
  siteId: AnalyticsSiteId;
  name: string;
  displayName: string | null;
  conversion: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  archivedAt: string | null;
  /** Occurrences / distinct visitors inside the requested window. */
  count: number;
  visitors: number;
}

const aggRow = z.object({
  site_id: z.string(),
  name: z.string(),
  count: z.coerce.number(),
  visitors: z.coerce.number(),
});

export async function listEventDefinitions(input: {
  siteIds: readonly AnalyticsSiteId[];
  window: ResolvedWindow;
  filters: readonly AnalyticsFilter[];
}): Promise<EventDefinitionListing[]> {
  if (input.siteIds.length === 0) return [];

  const defs = await db
    .select()
    .from(analyticsEventDefinition)
    .where(inArray(analyticsEventDefinition.siteId, [...input.siteIds]))
    .$withCache(false);
  if (defs.length === 0) return [];

  const filterSql = applyFilters({ target: "event", filters: input.filters });
  const scope = sql`${siteIdIn(sql`${analyticsEvent.siteId}`, input.siteIds)} AND ${tsRange(
    sql`${analyticsEvent.ts}`,
    input.window.from,
    input.window.to,
  )} AND ${analyticsEvent.kind} = 'event' AND ${analyticsEvent.name} IS NOT NULL`;
  const res = await db.execute(sql`
    SELECT ${analyticsEvent.siteId} AS site_id, ${analyticsEvent.name} AS name,
      count(*)::float8 AS count,
      count(DISTINCT ${analyticsEvent.visitorId})::float8 AS visitors
    FROM analytics_event
    WHERE ${filterSql ? sql`${scope} AND ${filterSql}` : scope}
    GROUP BY 1, 2
  `);
  const counts = new Map<string, { count: number; visitors: number }>();
  for (const raw of executeRows(res)) {
    const row = aggRow.safeParse(raw);
    if (row.success) {
      counts.set(`${row.data.site_id}\n${row.data.name}`, row.data);
    }
  }

  return defs
    .map((d): EventDefinitionListing => {
      const agg = counts.get(`${d.siteId}\n${d.name}`);
      return {
        id: d.id,
        siteId: d.siteId,
        name: d.name,
        displayName: d.displayName,
        conversion: d.conversion,
        firstSeenAt: d.firstSeenAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
        archivedAt: d.archivedAt?.toISOString() ?? null,
        count: agg?.count ?? 0,
        visitors: agg?.visitors ?? 0,
      };
    })
    .sort(
      (a, b) =>
        Number(a.archivedAt !== null) - Number(b.archivedAt !== null) ||
        b.count - a.count ||
        a.name.localeCompare(b.name),
    );
}

async function reselect(
  siteIds: readonly AnalyticsSiteId[],
  id: AnalyticsEventDefinitionId,
): Promise<EventDefinitionListing | null> {
  const rows = await db
    .select()
    .from(analyticsEventDefinition)
    .where(
      and(
        eq(analyticsEventDefinition.id, id),
        inArray(analyticsEventDefinition.siteId, [...siteIds]),
      ),
    )
    .limit(1)
    .$withCache(false);
  const d = rows[0];
  if (!d) return null;
  return {
    id: d.id,
    siteId: d.siteId,
    name: d.name,
    displayName: d.displayName,
    conversion: d.conversion,
    firstSeenAt: d.firstSeenAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
    archivedAt: d.archivedAt?.toISOString() ?? null,
    count: 0,
    visitors: 0,
  };
}

/** Patch displayName (null clears) and/or the conversion flag. */
export async function updateEventDefinition(input: {
  siteIds: readonly AnalyticsSiteId[];
  id: AnalyticsEventDefinitionId;
  displayName?: string | null;
  conversion?: boolean;
}): Promise<EventDefinitionListing | null> {
  if (input.siteIds.length === 0) return null;
  const patch = omitUndefined({ displayName: input.displayName, conversion: input.conversion });
  if (Object.keys(patch).length > 0) {
    await db
      .update(analyticsEventDefinition)
      .set(patch)
      .where(
        and(
          eq(analyticsEventDefinition.id, input.id),
          inArray(analyticsEventDefinition.siteId, [...input.siteIds]),
        ),
      );
  }
  return reselect(input.siteIds, input.id);
}

export async function setEventDefinitionArchived(input: {
  siteIds: readonly AnalyticsSiteId[];
  id: AnalyticsEventDefinitionId;
  archived: boolean;
}): Promise<EventDefinitionListing | null> {
  if (input.siteIds.length === 0) return null;
  await db
    .update(analyticsEventDefinition)
    .set({ archivedAt: input.archived ? sql`now()` : null })
    .where(
      and(
        eq(analyticsEventDefinition.id, input.id),
        inArray(analyticsEventDefinition.siteId, [...input.siteIds]),
      ),
    );
  return reselect(input.siteIds, input.id);
}
