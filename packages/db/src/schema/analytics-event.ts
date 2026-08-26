import type { AnalyticsSessionId, AnalyticsSiteId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

import { index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { analyticsDimensionColumns } from "./analytics";

/**
 * Raw web-analytics event stream (pageviews + custom events). One row per
 * event the tracker sent; engagement beacons and heartbeats are folded into
 * `analytics_session` / the in-memory presence map and never become rows.
 *
 * IMPORTANT: like edge_log, this table is NOT managed by drizzle-kit (it's
 * excluded from the schema barrel and from `tablesFilter`). It is
 * RANGE-partitioned by `ts` into daily child tables so retention is a
 * metadata-only DROP, and a partitioned table's PK must include the partition
 * key, hence (id, ts). The real DDL lives in
 * packages/api/src/analytics/partition.ts and runs at startup; this
 * definition exists only for typed inserts/queries. Keep the two in sync.
 *
 * `id` is the tracker's client-generated UUID so a retried batch dedupes on
 * `ON CONFLICT DO NOTHING`.
 */
export const analyticsEvent = pgTable(
  "analytics_event",
  {
    id: text("id").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    siteId: text("site_id").notNull().$type<AnalyticsSiteId>(),
    sessionId: text("session_id").notNull().$type<AnalyticsSessionId>(),
    visitorId: text("visitor_id").notNull(),
    /** "pageview" | "event" */
    kind: text("kind").notNull(),
    /** Custom event name; null for pageviews. */
    name: text("name"),
    props: jsonb("props").$type<JsonObject>(),
    /** Path without query/fragment (UTM already lifted into its columns). */
    path: text("path").notNull(),
    ...analyticsDimensionColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.ts] }),
    index("analytics_event_site_ts_idx").on(t.siteId, t.ts),
    index("analytics_event_site_session_idx").on(t.siteId, t.sessionId),
    index("analytics_event_ts_brin").using("brin", t.ts),
  ],
);

export type AnalyticsEventRow = typeof analyticsEvent.$inferSelect;
export type NewAnalyticsEventRow = typeof analyticsEvent.$inferInsert;
