/**
 * Per-event half of the collect pipeline (split from collect.ts under the
 * line cap): enrich one wire event, fold it into its session, and shape the
 * `analytics_event` row. See collect.ts for the batch-level flow.
 */

import type { NewAnalyticsEventRow } from "@otterdeploy/db/schema/analytics-event";
import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

import type { RateLimiter } from "../routers/webhooks/inbound-guard";
import type { CollectEvent } from "./collect-schema";
import type { ParsedPageUrl } from "./enrich";
import type { LookupOpenSession, OpenSession, SessionDimensions } from "./session-store";
import type { SiteContext } from "./site-cache";

import { sanitizeProps } from "./collect-schema";
import { languageOf, parsePageUrl, referrerHostOf, screenWidthOf } from "./enrich";
import { externalUserHash, utcDayOf, visitorHash } from "./identity";
import { pickDimensions } from "./session-store";
import { applySignal, identifySession, sidHashOf } from "./sessionizer";
import { bumpStat } from "./stats";

export type CollectStatus = 204 | 400 | 413 | 429;

export interface CollectInput {
  body: string;
  ip: string | null;
  userAgent: string | null;
  gpc: boolean;
  dnt: boolean;
  now?: number;
}

export interface CollectDeps {
  resolveSite(publicKey: string): Promise<SiteContext | null>;
  now(): number;
  lookupCountry(ip: string): string | null;
  enqueue(row: NewAnalyticsEventRow): void;
  noteEventDefinition(siteId: AnalyticsSiteId, name: string, at: number): void;
  noteFirstEvent(siteId: AnalyticsSiteId, at: number): void;
  rateLimiter: RateLimiter;
  lookupOpenSession?: LookupOpenSession;
}

/** Client clocks drift and the tracker retries from sessionStorage; a ts
 *  outside this window is replaced with the server clock. */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_EVENT_FUTURE_MS = 60_000;

function clampTs(ts: number, now: number): number {
  if (ts > now + MAX_EVENT_FUTURE_MS || ts < now - MAX_EVENT_AGE_MS) return now;
  return ts;
}

export interface BatchContext {
  ctx: SiteContext;
  deps: CollectDeps;
  now: number;
  ip: string;
  sidHash: string;
  ua: { browser: string; os: string; device: string };
  country: string | null;
  accepted: number;
  earliestAt: number | null;
}

export function batchContext(
  input: CollectInput,
  ctx: SiteContext,
  deps: CollectDeps,
  sid: string,
  ua: BatchContext["ua"],
): BatchContext {
  const ip = input.ip ?? "";
  return {
    ctx,
    deps,
    now: input.now ?? deps.now(),
    ip,
    sidHash: sidHashOf(ctx.site.id, sid),
    ua,
    country: ip ? deps.lookupCountry(ip) : null,
    accepted: 0,
    earliestAt: null,
  };
}

function visitorOf(b: BatchContext, at: number): string {
  return visitorHash({
    siteId: b.ctx.site.id,
    utcDay: utcDayOf(at),
    ip: b.ip,
    browser: b.ua.browser,
    os: b.ua.os,
    device: b.ua.device,
  });
}

/** First-touch candidates for the session: pv signals carry the browser-only
 *  facts (referrer, screen, language); the rest contribute page + batch dims. */
function dimsOf(
  b: BatchContext,
  e: Exclude<CollectEvent, { t: "id" }>,
  page: ParsedPageUrl,
): SessionDimensions {
  return {
    host: page.host,
    referrerHost: e.t === "pv" ? referrerHostOf(e.r, page.host) : null,
    utmSource: page.utm.source,
    utmMedium: page.utm.medium,
    utmCampaign: page.utm.campaign,
    utmTerm: page.utm.term,
    utmContent: page.utm.content,
    country: b.country,
    browser: b.ua.browser,
    os: b.ua.os,
    device: b.ua.device,
    screenW: e.t === "pv" ? screenWidthOf(e.sw) : null,
    language: e.t === "pv" ? languageOf(e.l) : null,
  };
}

/** Dimension columns come from the SESSION (first-touch attribution), so a
 *  visitor's later pageviews stay under the source that brought them; host
 *  and path are the event's own. */
function toEventRow(
  e: CollectEvent & { t: "pv" | "ev" },
  page: ParsedPageUrl,
  at: number,
  s: OpenSession,
): NewAnalyticsEventRow {
  return {
    ...pickDimensions(s),
    id: e.id,
    // `Date` at the drizzle seam only.
    ts: new Date(at),
    siteId: s.siteId,
    sessionId: s.id,
    visitorId: s.visitorId,
    kind: e.t === "pv" ? "pageview" : "event",
    name: e.t === "ev" ? e.n : null,
    props: e.t === "ev" ? sanitizeProps(e.p) : null,
    path: page.path,
    host: page.host,
  };
}

export async function processEvent(b: BatchContext, e: CollectEvent): Promise<void> {
  const siteId = b.ctx.site.id;
  const at = clampTs(e.ts, b.now);
  const key = { siteId, visitorId: visitorOf(b, at), sidHash: b.sidHash };

  if (e.t === "id") {
    identifySession(key, externalUserHash(siteId, e.uid), at);
    return;
  }

  const page: ParsedPageUrl | null = parsePageUrl(e.u);
  if (!page) {
    bumpStat(siteId, "invalid");
    return;
  }
  if (b.ctx.allowedHosts.size > 0 && !b.ctx.allowedHosts.has(page.host)) {
    bumpStat(siteId, "rejectedHost");
    return;
  }
  if (b.ctx.excludePathRe?.test(page.path)) {
    bumpStat(siteId, "rejectedPath");
    return;
  }

  const session = await applySignal(
    key,
    {
      kind: e.t,
      at,
      path: page.path,
      dims: dimsOf(b, e, page),
      activeMs: e.t === "eng" ? e.a : undefined,
      scroll: e.t === "eng" ? e.sc : undefined,
    },
    { lookupOpenSession: b.deps.lookupOpenSession },
  );

  if (e.t === "pv" || e.t === "ev") {
    b.deps.enqueue(toEventRow(e, page, at, session));
    if (e.t === "ev") b.deps.noteEventDefinition(siteId, e.n, at);
    b.earliestAt = b.earliestAt === null ? at : Math.min(b.earliestAt, at);
  }
  b.accepted++;
  bumpStat(siteId, "accepted");
}
