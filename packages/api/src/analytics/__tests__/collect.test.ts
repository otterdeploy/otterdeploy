import type { AnalyticsSiteRow } from "@otterdeploy/db/schema/analytics";
import type { NewAnalyticsEventRow } from "@otterdeploy/db/schema/analytics-event";

import { idSchema } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Everything DB-backed is injected through `deps`; the client itself must
// never be touched here.
vi.mock("@otterdeploy/db", () => ({ db: {} }));

import type { CollectDeps, CollectInput } from "../collect";
import type { SiteContext } from "../site-cache";

import { handleCollect } from "../collect";
import { compileExcludePaths } from "../enrich";
import { resetSessionizer, takeDirtySessions } from "../sessionizer";
import { collectStats, resetCollectStats } from "../stats";

const KEY = `od_${"ab".repeat(16)}`;
const siteId = idSchema.analyticsSite.parse("asite_collect");
const NOW = Date.UTC(2026, 7, 26, 12, 0, 0);
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function siteRow(over: Partial<AnalyticsSiteRow> = {}): AnalyticsSiteRow {
  return {
    id: siteId,
    projectId: idSchema.project.parse("prj_collect"),
    organizationId: idSchema.organization.parse("org_collect"),
    publicKey: KEY,
    keyRotatedAt: null,
    extraHosts: [],
    excludePaths: [],
    respectDnt: false,
    requireConsent: false,
    firstEventAt: null,
    // `Date` at the drizzle row seam only.
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

interface Harness {
  deps: CollectDeps;
  rows: NewAnalyticsEventRow[];
  definitions: Array<{ name: string; at: number }>;
  firsts: number[];
}

function harness(ctx: SiteContext | null, over: Partial<CollectDeps> = {}): Harness {
  const rows: NewAnalyticsEventRow[] = [];
  const definitions: Array<{ name: string; at: number }> = [];
  const firsts: number[] = [];
  const deps: CollectDeps = {
    resolveSite: async () => ctx,
    now: () => NOW,
    lookupCountry: () => "DE",
    enqueue: (row) => void rows.push(row),
    noteEventDefinition: (_site, name, at) => void definitions.push({ name, at }),
    noteFirstEvent: (_site, at) => void firsts.push(at),
    rateLimiter: { allow: () => true },
    lookupOpenSession: async () => null,
    ...over,
  };
  return { deps, rows, definitions, firsts };
}

function context(
  over: Partial<SiteContext> = {},
  site: Partial<AnalyticsSiteRow> = {},
): SiteContext {
  return {
    site: siteRow(site),
    allowedHosts: new Set(["example.com"]),
    excludePathRe: null,
    ...over,
  };
}

function body(events: unknown[], over: Record<string, unknown> = {}): string {
  return JSON.stringify({ k: KEY, v: 1, sid: "tab-1", e: events, ...over });
}

const pv = {
  id: "11111111-1111-4111-8111-111111111111",
  t: "pv",
  ts: NOW - 1_000,
  u: "https://example.com/pricing?utm_source=news&q=x",
  r: "https://google.com/",
  sw: 1440,
  l: "en-GB",
};

function input(over: Partial<CollectInput> = {}): CollectInput {
  return {
    body: body([pv]),
    ip: "203.0.113.9",
    userAgent: CHROME,
    gpc: false,
    dnt: false,
    ...over,
  };
}

beforeEach(() => {
  resetSessionizer();
  resetCollectStats();
});

describe("handleCollect", () => {
  test("accepts a pageview: row enqueued with session attribution", async () => {
    const h = harness(context());
    const res = await handleCollect(input(), h.deps);
    expect(res.status).toBe(204);
    expect(h.rows).toHaveLength(1);
    const row = h.rows[0];
    expect(row?.kind).toBe("pageview");
    expect(row?.path).toBe("/pricing");
    expect(row?.host).toBe("example.com");
    expect(row?.utmSource).toBe("news");
    expect(row?.referrerHost).toBe("google.com");
    expect(row?.country).toBe("DE");
    expect(row?.browser).toBe("Chrome");
    expect(row?.language).toBe("en-gb");
    expect(row?.visitorId).toMatch(/^[0-9a-f]{32}$/);
    expect(row?.sessionId.startsWith("ases_")).toBe(true);
    expect(row?.ts.getTime()).toBe(NOW - 1_000);
    expect(h.firsts).toEqual([NOW - 1_000]);
    expect(collectStats(siteId).accepted).toBe(1);
  });

  test("400 on malformed body, 413 past 64 KB", async () => {
    const h = harness(context());
    expect((await handleCollect(input({ body: "{nope" }), h.deps)).status).toBe(400);
    expect((await handleCollect(input({ body: "x".repeat(65 * 1024) }), h.deps)).status).toBe(413);
    expect(h.rows).toHaveLength(0);
  });

  test("unknown key drops silently with 204", async () => {
    const h = harness(null);
    expect((await handleCollect(input(), h.deps)).status).toBe(204);
    expect(h.rows).toHaveLength(0);
  });

  test("GPC always drops; DNT only when the site opted in", async () => {
    const gpc = harness(context());
    expect((await handleCollect(input({ gpc: true }), gpc.deps)).status).toBe(204);
    expect(gpc.rows).toHaveLength(0);

    const dntIgnored = harness(context());
    await handleCollect(input({ dnt: true }), dntIgnored.deps);
    expect(dntIgnored.rows).toHaveLength(1);

    const dntHonored = harness(context({}, { respectDnt: true }));
    await handleCollect(input({ dnt: true }), dntHonored.deps);
    expect(dntHonored.rows).toHaveLength(0);
  });

  test("429 when the per-IP limiter refuses", async () => {
    const h = harness(context(), { rateLimiter: { allow: () => false } });
    expect((await handleCollect(input(), h.deps)).status).toBe(429);
    expect(collectStats(siteId).rateLimited).toBe(1);
    expect(h.rows).toHaveLength(0);
  });

  test("bot UA is counted and dropped with 204", async () => {
    const h = harness(context());
    const res = await handleCollect(
      input({ userAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)" }),
      h.deps,
    );
    expect(res.status).toBe(204);
    expect(collectStats(siteId).bots).toBe(1);
    expect(h.rows).toHaveLength(0);
  });

  test("host allowlist: outside host counted, empty allowlist allows any", async () => {
    const rejected = harness(context({ allowedHosts: new Set(["other.com"]) }));
    await handleCollect(input(), rejected.deps);
    expect(rejected.rows).toHaveLength(0);
    expect(collectStats(siteId).rejectedHost).toBe(1);

    const open = harness(context({ allowedHosts: new Set() }));
    await handleCollect(input(), open.deps);
    expect(open.rows).toHaveLength(1);
  });

  test("exclude-path globs drop matching pageviews", async () => {
    const h = harness(context({ excludePathRe: compileExcludePaths(["/pricing"]) }));
    await handleCollect(input(), h.deps);
    expect(h.rows).toHaveLength(0);
    expect(collectStats(siteId).rejectedPath).toBe(1);
  });

  test("custom events carry sanitized props and register a definition", async () => {
    const h = harness(context());
    await handleCollect(
      input({
        body: body([
          pv,
          {
            id: "22222222-2222-4222-8222-222222222222",
            t: "ev",
            ts: NOW - 500,
            u: "https://example.com/pricing",
            n: "signup",
            p: { plan: "pro", token: "leak-me" },
          },
        ]),
      }),
      h.deps,
    );
    expect(h.rows).toHaveLength(2);
    const ev = h.rows[1];
    expect(ev?.kind).toBe("event");
    expect(ev?.name).toBe("signup");
    expect(ev?.props).toEqual({ plan: "pro" });
    expect(ev?.sessionId).toBe(h.rows[0]?.sessionId);
    expect(h.definitions).toEqual([{ name: "signup", at: NOW - 500 }]);
  });

  test("identify attaches a hashed user id to the session, never the raw id", async () => {
    const h = harness(context());
    await handleCollect(
      input({
        body: body([pv, { id: "3", t: "id", ts: NOW - 400, uid: "user_123" }]),
      }),
      h.deps,
    );
    const rows = takeDirtySessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalUserId).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[0]?.externalUserId).not.toContain("user_123");
  });

  test("engagement and heartbeats never become rows but bump the session", async () => {
    const h = harness(context());
    await handleCollect(
      input({
        body: body([
          pv,
          { id: "4", t: "eng", ts: NOW - 300, u: "https://example.com/pricing", a: 5_000, sc: 60 },
          { id: "5", t: "hb", ts: NOW - 200, u: "https://example.com/pricing" },
        ]),
      }),
      h.deps,
    );
    expect(h.rows).toHaveLength(1);
    expect(collectStats(siteId).accepted).toBe(3);
    const [session] = takeDirtySessions();
    expect(session?.activeMs).toBe(5_000);
    expect(session?.scroll).toBe(60);
    expect(session?.lastAt.getTime()).toBe(NOW - 200);
  });

  test("an invalid URL skips that event but keeps the rest of the batch", async () => {
    const h = harness(context());
    await handleCollect(input({ body: body([{ ...pv, id: "6", u: "notaurl" }, pv]) }), h.deps);
    expect(h.rows).toHaveLength(1);
    expect(collectStats(siteId).invalid).toBe(1);
  });

  test("first-event note is skipped once the site row already has one", async () => {
    const h = harness(context({}, { firstEventAt: new Date(1) }));
    await handleCollect(input(), h.deps);
    expect(h.firsts).toEqual([]);
  });

  test("never throws: an exploding dep is logged, counted, answered 204", async () => {
    const h = harness(context(), {
      enqueue: () => {
        throw new Error("db down");
      },
    });
    const res = await handleCollect(input(), h.deps);
    expect(res.status).toBe(204);
    expect(collectStats(siteId).invalid).toBe(1);
  });
});
