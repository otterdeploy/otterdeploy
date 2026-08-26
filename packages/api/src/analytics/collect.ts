/**
 * The collect pipeline behind `POST /a/c` (docs/designs/web-analytics.md §4):
 * parse → site by key → GPC/DNT → per-IP limiter → bot gate → per event:
 * enrich → identity → sessionize → enqueue (collect-event.ts). The endpoint
 * is public, so it never throws and never leaks why something was dropped:
 * every outcome is a bare status, and drops are only visible as per-site
 * counters (stats.ts).
 *
 * Every collaborator with a side effect is injectable via `deps`, so the
 * whole pipeline unit-tests without a DB.
 */

import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import { log } from "evlog";

import type { RateLimiter } from "../routers/webhooks/inbound-guard";
import type { CollectDeps, CollectInput, CollectStatus } from "./collect-event";
import type { CollectBatch } from "./collect-schema";
import type { UaFamilies } from "./enrich";
import type { SiteContext } from "./site-cache";

import { lookupCountry } from "../edge-logs/geo";
import { createRateLimiter } from "../routers/webhooks/inbound-guard";
import { batchContext, processEvent } from "./collect-event";
import { MAX_BODY_BYTES, parseCollectBody } from "./collect-schema";
import { uaFamiliesOf } from "./enrich";
import { resolveSiteByKey } from "./site-cache";
import { bumpStat } from "./stats";
import { enqueueEvent, noteEventDefinition, noteFirstEvent } from "./writer";

export type { CollectDeps, CollectInput, CollectStatus } from "./collect-event";

export const COLLECT_RATE_LIMIT = 600;
export const COLLECT_RATE_WINDOW_MS = 60_000;

declare global {
  var __analyticsCollectLimiter: RateLimiter | undefined;
}

function defaultDeps(): CollectDeps {
  globalThis.__analyticsCollectLimiter ??= createRateLimiter({
    limit: COLLECT_RATE_LIMIT,
    windowMs: COLLECT_RATE_WINDOW_MS,
  });
  return {
    resolveSite: resolveSiteByKey,
    now: Date.now,
    lookupCountry,
    enqueue: enqueueEvent,
    noteEventDefinition,
    noteFirstEvent,
    rateLimiter: globalThis.__analyticsCollectLimiter,
  };
}

/** Privacy/abuse gates a whole batch fails as one: the early-exit status, or
 *  null to proceed. GPC is honoured always; DNT only when the site opted in
 *  (design §3, §8). */
function gate(
  input: CollectInput,
  ctx: SiteContext,
  deps: CollectDeps,
  families: UaFamilies,
): CollectStatus | null {
  if (input.gpc) return 204;
  if (ctx.site.respectDnt && input.dnt) return 204;
  if (!deps.rateLimiter.allow(input.ip ?? "unknown")) {
    bumpStat(ctx.site.id, "rateLimited");
    return 429;
  }
  if (families.bot) {
    bumpStat(ctx.site.id, "bots");
    return 204;
  }
  return null;
}

async function handleBatch(
  input: CollectInput,
  deps: CollectDeps,
  slot: { siteId: AnalyticsSiteId | null },
): Promise<CollectStatus> {
  if (Buffer.byteLength(input.body, "utf8") > MAX_BODY_BYTES) return 413;
  const parsed = parseCollectBody(input.body);
  if (parsed.isErr()) return 400;
  const batch: CollectBatch = parsed.value;

  const ctx = await deps.resolveSite(batch.k);
  if (!ctx) return 204; // Unknown key: silently drop, no oracle for key scans.
  slot.siteId = ctx.site.id;

  const families = uaFamiliesOf(input.userAgent);
  const gated = gate(input, ctx, deps, families);
  if (gated !== null) return gated;

  const b = batchContext(input, ctx, deps, batch.sid, {
    browser: families.browser,
    os: families.os,
    device: families.device,
  });
  for (const e of batch.e) await processEvent(b, e);

  if (b.earliestAt !== null && ctx.site.firstEventAt === null) {
    deps.noteFirstEvent(ctx.site.id, b.earliestAt);
  }
  return 204;
}

/**
 * Handle one collect request. NEVER throws: any unexpected error is logged,
 * counted against the site (when known) and answered 204, because a public
 * endpoint must not leak errors to arbitrary pages.
 */
export async function handleCollect(
  input: CollectInput,
  deps: CollectDeps = defaultDeps(),
): Promise<{ status: CollectStatus }> {
  const slot: { siteId: AnalyticsSiteId | null } = { siteId: null };
  const res = await Result.tryPromise({
    try: () => handleBatch(input, deps, slot),
    catch: (cause) => cause,
  });
  return res.match({
    ok: (status) => ({ status }),
    err: (cause) => {
      if (slot.siteId) bumpStat(slot.siteId, "invalid");
      log.warn({
        analytics: { ingest: "collect-unexpected-error" },
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return { status: 204 };
    },
  });
}
