import type {
  AnalyticsEventDefinitionId,
  AnalyticsFunnelId,
  AnalyticsSessionId,
  AnalyticsSiteId,
  OrganizationId,
  ProjectId,
} from "@otterdeploy/shared/id";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { project } from "./project";

/**
 * Web analytics (tracker plane). Design: docs/designs/web-analytics.md.
 *
 * `analytics_site` is 1:1 with a project and owns the public tracking key the
 * snippet carries. `analytics_session` is the sessionizer's output (one row
 * per visit, upserted as events arrive). `analytics_event_definition` is the
 * auto-registered catalogue of custom event names (with the owner-set
 * `conversion` flag that turns an event into a goal). `analytics_funnel`
 * stores saved funnel definitions; they are computed at read time.
 *
 * The raw event stream (`analytics_event`) is NOT here: it is a
 * RANGE-partitioned table owned by packages/api/src/analytics/partition.ts,
 * declared in ./analytics-event.ts and excluded from the schema barrel exactly
 * like edge_log.
 */

export const analyticsFunnelScopeEnum = pgEnum("analytics_funnel_scope", ["visitor", "session"]);

export const analyticsSite = pgTable(
  "analytics_site",
  {
    id: text("id")
      .primaryKey()
      .$type<AnalyticsSiteId>()
      .$defaultFn(() => createId(ID_PREFIX.analyticsSite)),
    projectId: text("project_id")
      .notNull()
      .$type<ProjectId>()
      .references(() => project.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Public tracking key (`od_` + 32 hex). Public by design: it identifies
     *  the site the way a Plausible domain does, and the host allowlist is
     *  what stops a third party from polluting the data. */
    publicKey: text("public_key").notNull(),
    keyRotatedAt: timestamp("key_rotated_at", { withTimezone: true }),
    /** Hosts allowed to send events besides the project's own proxy routes
     *  (sites fronted by an external CDN or a domain otterdeploy doesn't
     *  serve). Stored normalized: lowercase, no port. */
    extraHosts: text("extra_hosts").array().notNull().default([]),
    /** Glob patterns (`/admin/*`) whose pageviews are dropped at collect. */
    excludePaths: text("exclude_paths").array().notNull().default([]),
    /** Honour the (deprecated) DNT header in addition to GPC. */
    respectDnt: boolean("respect_dnt").notNull().default(false),
    /** When true the tracker sends nothing until `otter.consent("granted")`. */
    requireConsent: boolean("require_consent").notNull().default(false),
    /** Set once by the writer when the first event lands; drives the
     *  Setup checklist ("snippet verified"). */
    firstEventAt: timestamp("first_event_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("analytics_site_project_unique").on(t.projectId),
    uniqueIndex("analytics_site_public_key_unique").on(t.publicKey),
    index("analytics_site_organization_id_idx").on(t.organizationId),
  ],
);

/** Dimension columns shared by the event stream and the session row. A
 *  factory (not a const) so each table gets fresh builder instances. */
export function analyticsDimensionColumns() {
  return {
    /** Page host, normalized (lowercase, no port). */
    host: text("host").notNull(),
    /** Referrer host, normalized; null = direct / self-referral. */
    referrerHost: text("referrer_host"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    /** ISO-3166 alpha-2 from GeoIP; null when geo is unavailable. */
    country: text("country"),
    /** Family names only (no versions): jsonb-cardinality and privacy. */
    browser: text("browser").notNull(),
    os: text("os").notNull(),
    device: text("device").notNull(),
    screenW: smallint("screen_w"),
    /** BCP-47 language tag as sent by the browser, ≤ 8 chars. */
    language: text("language"),
  };
}

export const analyticsSession = pgTable(
  "analytics_session",
  {
    id: text("id")
      .primaryKey()
      .$type<AnalyticsSessionId>()
      .$defaultFn(() => createId(ID_PREFIX.analyticsSession)),
    siteId: text("site_id")
      .notNull()
      .$type<AnalyticsSiteId>()
      .references(() => analyticsSite.id, { onDelete: "cascade" }),
    /** Daily-rotating salted hash, 32 hex. Never an IP. */
    visitorId: text("visitor_id").notNull(),
    /** HMAC of the `identify()` id, site-scoped; null for anonymous visits. */
    externalUserId: text("external_user_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull(),
    pageviews: integer("pageviews").notNull().default(0),
    events: integer("events").notNull().default(0),
    /** Sum of engagement-beacon active time. */
    activeMs: integer("active_ms").notNull().default(0),
    /** Max scroll depth reached (0–100), null until an engagement beacon. */
    scroll: smallint("scroll"),
    entryPath: text("entry_path").notNull(),
    exitPath: text("exit_path").notNull(),
    ...analyticsDimensionColumns(),
  },
  (t) => [
    index("analytics_session_site_started_idx").on(t.siteId, t.startedAt),
    index("analytics_session_site_visitor_last_idx").on(t.siteId, t.visitorId, t.lastAt),
  ],
);

export const analyticsEventDefinition = pgTable(
  "analytics_event_definition",
  {
    id: text("id")
      .primaryKey()
      .$type<AnalyticsEventDefinitionId>()
      .$defaultFn(() => createId(ID_PREFIX.analyticsEventDefinition)),
    siteId: text("site_id")
      .notNull()
      .$type<AnalyticsSiteId>()
      .references(() => analyticsSite.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    displayName: text("display_name"),
    /** A conversion event is a goal: it gets a conversion rate and appears in
     *  the Goals card. Owner-set; auto-registered names start false. */
    conversion: boolean("conversion").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("analytics_event_definition_site_name_unique").on(t.siteId, t.name)],
);

/** One funnel step: a page path or a custom event name. `match` applies to
 *  paths only (`exact` default; `contains` for path families). */
export interface AnalyticsFunnelStep {
  type: "path" | "event";
  value: string;
  match?: "exact" | "contains";
}

export const analyticsFunnel = pgTable(
  "analytics_funnel",
  {
    id: text("id")
      .primaryKey()
      .$type<AnalyticsFunnelId>()
      .$defaultFn(() => createId(ID_PREFIX.analyticsFunnel)),
    siteId: text("site_id")
      .notNull()
      .$type<AnalyticsSiteId>()
      .references(() => analyticsSite.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    steps: jsonb("steps").$type<AnalyticsFunnelStep[]>().notNull(),
    scope: analyticsFunnelScopeEnum("scope").notNull().default("visitor"),
    /** Max time between first and last step, ≤ 720 (30 days). */
    windowHours: integer("window_hours").notNull().default(24),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [index("analytics_funnel_site_idx").on(t.siteId)],
);

export type AnalyticsSiteRow = typeof analyticsSite.$inferSelect;
export type NewAnalyticsSiteRow = typeof analyticsSite.$inferInsert;
export type AnalyticsSessionRow = typeof analyticsSession.$inferSelect;
export type NewAnalyticsSessionRow = typeof analyticsSession.$inferInsert;
export type AnalyticsEventDefinitionRow = typeof analyticsEventDefinition.$inferSelect;
export type AnalyticsFunnelRow = typeof analyticsFunnel.$inferSelect;
export type NewAnalyticsFunnelRow = typeof analyticsFunnel.$inferInsert;
