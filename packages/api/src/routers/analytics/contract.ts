/**
 * Web-analytics (tracker plane) contract: site management + the read API the
 * dashboard is built on. Scoping mirrors edgeLogs.analytics (install-wide
 * behind install:read, otherwise org/project), windows mirror the design's
 * preset table, and every read answers an empty scope with honest zeros.
 * Design: docs/designs/web-analytics.md §2/§6.
 */

import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import { BREAKDOWN_DIMENSIONS, FILTER_DIMENSIONS, FILTER_OPS } from "../../analytics/query/filters";
import { BUCKETS, RANGE_PRESETS } from "../../analytics/query/window";
import { zJsonObject } from "../../lib/z-json";
import { projectIdField } from "../project/contract/shared";

const tag = "analytics";

const siteIdField = zId(ID_PREFIX.analyticsSite);
const sessionIdField = zId(ID_PREFIX.analyticsSession);
const eventDefinitionIdField = zId(ID_PREFIX.analyticsEventDefinition);

const analyticsErrors = {
  FORBIDDEN: {
    status: 403,
    message: "Installation administrator access is required for install-wide analytics.",
  },
} as const;

const siteNotFoundErrors = {
  NOT_FOUND: { status: 404, message: "Project not found" },
  INVALID_INPUT: { status: 400, message: "Invalid hosts or path patterns." },
} as const;

const definitionNotFoundErrors = {
  NOT_FOUND: { status: 404, message: "Event definition not found" },
} as const;

// ─── Shared query input ────────────────────────────────────────────────────

export const analyticsFilterSchema = z.object({
  dim: z.enum(FILTER_DIMENSIONS),
  op: z.enum(FILTER_OPS),
  value: z.string().min(1).max(512),
});

const scopeFields = {
  /** Restrict to one project's site; omitted ⇒ all the org's sites. */
  projectId: projectIdField.optional(),
  /** Every site on the install. Install-admin (read) only; overrides projectId. */
  installWide: z.boolean().optional(),
};

const windowFields = {
  range: z.enum(RANGE_PRESETS).default("7d"),
  /** Custom window (epoch ms), used with range "custom". Both or neither,
   *  from < to, at most 400 days (the retention ceiling). */
  from: z.number().int().positive().optional(),
  to: z.number().int().positive().optional(),
  /** IANA timezone for midnight cuts and bucket boundaries; invalid ⇒ UTC. */
  tz: z.string().min(1).max(64).default("UTC"),
  filters: z.array(analyticsFilterSchema).max(20).default([]),
  compare: z.boolean().default(false),
};

const MAX_WINDOW_MS = 400 * 24 * 60 * 60 * 1000;

/** The custom-window rules, shared by every windowed input. Restated per
 *  schema (the edge-logs precedent) because refinements don't survive
 *  `.extend`; named checks keep each rule one implementation. */
interface CustomWindow {
  from?: number;
  to?: number;
}
const windowPair = (v: CustomWindow) => (v.from === undefined) === (v.to === undefined);
const windowOrder = (v: CustomWindow) =>
  v.from === undefined || v.to === undefined || v.from < v.to;
const windowSpan = (v: CustomWindow) =>
  v.from === undefined || v.to === undefined || v.to - v.from <= MAX_WINDOW_MS;

const WINDOW_MESSAGES = {
  pair: "from and to must be provided together",
  order: "from must be before to",
  span: "window must be 400 days or less",
} as const;

export const analyticsQueryInput = z
  .object({ ...scopeFields, ...windowFields })
  .refine(windowPair, { message: WINDOW_MESSAGES.pair })
  .refine(windowOrder, { message: WINDOW_MESSAGES.order })
  .refine(windowSpan, { message: WINDOW_MESSAGES.span });

export const analyticsBreakdownInput = z
  .object({
    ...scopeFields,
    ...windowFields,
    dimension: z.enum(BREAKDOWN_DIMENSIONS),
    limit: z.number().int().positive().max(500).default(10),
    offset: z.number().int().min(0).default(0),
  })
  .refine(windowPair, { message: WINDOW_MESSAGES.pair })
  .refine(windowOrder, { message: WINDOW_MESSAGES.order })
  .refine(windowSpan, { message: WINDOW_MESSAGES.span });

const realtimeInput = z.object(scopeFields);

const visitorInput = z.object({
  ...scopeFields,
  /** Daily-rotating visitor hash from a breakdown/realtime row. */
  visitorId: z.string().min(8).max(64),
});

// ─── Site management ───────────────────────────────────────────────────────

const siteSchema = z.object({
  id: siteIdField,
  projectId: projectIdField,
  /** Public by design (identifies the site the way a Plausible domain does). */
  publicKey: z.string(),
  keyRotatedAt: z.string().nullable(),
  extraHosts: z.array(z.string()),
  excludePaths: z.array(z.string()),
  respectDnt: z.boolean(),
  requireConsent: z.boolean(),
  /** Set once when the first event lands; drives "snippet verified". */
  firstEventAt: z.string().nullable(),
  createdAt: z.string(),
});

/** In-memory since-process-start collect counters (never persisted). */
const collectStatsSchema = z.object({
  accepted: z.number(),
  bots: z.number(),
  rejectedHost: z.number(),
  rejectedPath: z.number(),
  invalid: z.number(),
  rateLimited: z.number(),
});

const siteResultSchema = z.object({
  /** Null until `site.ensure` creates it (Setup's first open). */
  site: siteSchema.nullable(),
  snippet: z.string().nullable(),
  /** Project proxy-route domains ∪ extraHosts: where events are accepted. */
  allowedHosts: z.array(z.string()),
  stats: collectStatsSchema.nullable(),
});

const siteUpdateInput = z.object({
  projectId: projectIdField,
  extraHosts: z.array(z.string().min(1).max(253)).max(50).optional(),
  /** `/admin/*`-style globs whose pageviews are dropped at collect. */
  excludePaths: z.array(z.string().min(1).max(256)).max(100).optional(),
  respectDnt: z.boolean().optional(),
  requireConsent: z.boolean().optional(),
});

// ─── Overview ──────────────────────────────────────────────────────────────

const totalsSchema = z.object({
  visitors: z.number(),
  pageviews: z.number(),
  sessions: z.number(),
  /** bounced / sessions, 0..1; null when the window has no sessions. */
  bounceRate: z.number().nullable(),
  avgDurationMs: z.number().nullable(),
  viewsPerVisit: z.number().nullable(),
  /** Distinct visitors who triggered a conversion-flagged event. */
  conversions: z.number(),
});

const overviewResultSchema = z.object({
  totals: totalsSchema,
  /** The equal-length window immediately before; null unless `compare`. */
  previous: totalsSchema.nullable(),
  /** Zero-filled up to now, never into the future. `t` = ISO bucket start. */
  series: z.array(
    z.object({
      t: z.string(),
      visitors: z.number(),
      pageviews: z.number(),
      sessions: z.number(),
    }),
  ),
  bucket: z.enum(BUCKETS),
  /** Distinct visitors active in the last 5 minutes (DB-backed). */
  liveVisitors: z.number(),
  /** The resolved window (epoch ms) after preset/tz/`all`-clamp resolution. */
  window: z.object({
    from: z.number(),
    to: z.number(),
    previous: z.object({ from: z.number(), to: z.number() }),
  }),
});

// ─── Breakdown ─────────────────────────────────────────────────────────────

const breakdownRowSchema = z.object({
  /** Null keys render as "(none)"; a null referrer as "Direct / none". */
  key: z.string(),
  visitors: z.number(),
  /** Event-grouped dimensions only. */
  pageviews: z.number().optional(),
  /** entryPath/exitPath rows only. */
  sessions: z.number().optional(),
  bounceRate: z.number().nullable().optional(),
  avgDurationMs: z.number().nullable().optional(),
  /** `event` and `goal` rows only. */
  events: z.number().optional(),
  /** `goal` rows only. */
  conversions: z.number().optional(),
  conversionRate: z.number().optional(),
  /** visitors / window total visitors, 0..1. */
  share: z.number(),
});

const breakdownResultSchema = z.object({
  dimension: z.enum(BREAKDOWN_DIMENSIONS),
  rows: z.array(breakdownRowSchema),
  /** Distinct visitors in the (filtered) window: the share denominator. */
  total: z.number(),
  hasMore: z.boolean(),
});

// ─── Realtime ──────────────────────────────────────────────────────────────

const onlineEntrySchema = z.object({
  visitorId: z.string(),
  sessionId: sessionIdField,
  /** The session's exit path: where the visitor was last seen. */
  path: z.string(),
  host: z.string(),
  country: z.string().nullable(),
  browser: z.string(),
  os: z.string(),
  device: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});

const recentSessionSchema = z.object({
  sessionId: sessionIdField,
  visitorId: z.string(),
  startedAt: z.string(),
  lastAt: z.string(),
  pageviews: z.number(),
  events: z.number(),
  entryPath: z.string(),
  exitPath: z.string(),
  referrerHost: z.string().nullable(),
  country: z.string().nullable(),
  browser: z.string(),
  os: z.string(),
  device: z.string(),
  /** Active inside the 5-minute live window. */
  live: z.boolean(),
});

const realtimeResultSchema = z.object({
  liveVisitors: z.number(),
  byPath: z.array(z.object({ path: z.string(), visitors: z.number() })),
  /** Live sessions, most recent first (≤ 50). */
  online: z.array(onlineEntrySchema),
  /** Sessions active in the last 24 h, most recent first (≤ 50). */
  recent: z.array(recentSessionSchema),
});

// ─── Visitor trail ─────────────────────────────────────────────────────────

const trailEventSchema = z.object({
  ts: z.string(),
  kind: z.string(),
  name: z.string().nullable(),
  path: z.string(),
  props: zJsonObject.nullable(),
});

const trailSessionSchema = z.object({
  sessionId: sessionIdField,
  siteId: siteIdField,
  startedAt: z.string(),
  lastAt: z.string(),
  pageviews: z.number(),
  events: z.number(),
  activeMs: z.number(),
  scroll: z.number().nullable(),
  entryPath: z.string(),
  exitPath: z.string(),
  host: z.string(),
  referrerHost: z.string().nullable(),
  country: z.string().nullable(),
  browser: z.string(),
  os: z.string(),
  device: z.string(),
  /** This session's events, oldest first (capped at 500 across the trail). */
  eventsList: z.array(trailEventSchema),
});

const visitorResultSchema = z.object({ sessions: z.array(trailSessionSchema) });

// ─── Event definitions ─────────────────────────────────────────────────────

const definitionSchema = z.object({
  id: eventDefinitionIdField,
  siteId: siteIdField,
  name: z.string(),
  displayName: z.string().nullable(),
  conversion: z.boolean(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  archivedAt: z.string().nullable(),
  /** Occurrences / distinct visitors inside the requested window. */
  count: z.number(),
  visitors: z.number(),
});

const definitionsResultSchema = z.object({ definitions: z.array(definitionSchema) });
const definitionResultSchema = z.object({ definition: definitionSchema });

const eventsUpdateInput = z.object({
  ...scopeFields,
  id: eventDefinitionIdField,
  displayName: z.string().min(1).max(120).nullable().optional(),
  conversion: z.boolean().optional(),
});

const eventsArchiveInput = z.object({
  ...scopeFields,
  id: eventDefinitionIdField,
  archived: z.boolean(),
});

// ─── Contract ──────────────────────────────────────────────────────────────

export const analyticsContract = {
  site: {
    get: oc
      .errors(siteNotFoundErrors)
      .meta({ path: "/analytics/site", tag, method: "GET" })
      .input(z.object({ projectId: projectIdField }))
      .output(siteResultSchema),

    // Lazily creates the project's site (first Setup open), minting the key.
    ensure: oc
      .errors(siteNotFoundErrors)
      .meta({ path: "/analytics/site/ensure", tag, method: "POST" })
      .input(z.object({ projectId: projectIdField }))
      .output(siteResultSchema),

    update: oc
      .errors(siteNotFoundErrors)
      .meta({ path: "/analytics/site/update", tag, method: "POST" })
      .input(siteUpdateInput)
      .output(siteResultSchema),

    // New key immediately; the old one stops being accepted within the
    // collector's 60 s site-cache TTL (invalidated here, so usually at once).
    rotateKey: oc
      .errors(siteNotFoundErrors)
      .meta({ path: "/analytics/site/rotate-key", tag, method: "POST" })
      .input(z.object({ projectId: projectIdField }))
      .output(siteResultSchema),
  },

  overview: oc
    .errors(analyticsErrors)
    .meta({ path: "/analytics/overview", tag, method: "GET" })
    .input(analyticsQueryInput)
    .output(overviewResultSchema),

  breakdown: oc
    .errors(analyticsErrors)
    .meta({ path: "/analytics/breakdown", tag, method: "GET" })
    .input(analyticsBreakdownInput)
    .output(breakdownResultSchema),

  realtime: oc
    .errors(analyticsErrors)
    .meta({ path: "/analytics/realtime", tag, method: "GET" })
    .input(realtimeInput)
    .output(realtimeResultSchema),

  visitor: oc
    .errors(analyticsErrors)
    .meta({ path: "/analytics/visitor", tag, method: "GET" })
    .input(visitorInput)
    .output(visitorResultSchema),

  events: {
    list: oc
      .errors(analyticsErrors)
      .meta({ path: "/analytics/events", tag, method: "GET" })
      .input(analyticsQueryInput)
      .output(definitionsResultSchema),

    update: oc
      .errors({ ...analyticsErrors, ...definitionNotFoundErrors })
      .meta({ path: "/analytics/events/update", tag, method: "POST" })
      .input(eventsUpdateInput)
      .output(definitionResultSchema),

    archive: oc
      .errors({ ...analyticsErrors, ...definitionNotFoundErrors })
      .meta({ path: "/analytics/events/archive", tag, method: "POST" })
      .input(eventsArchiveInput)
      .output(definitionResultSchema),
  },
};
