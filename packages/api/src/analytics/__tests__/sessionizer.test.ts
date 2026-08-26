import { idSchema } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

// The sessionizer's DB fallback lives behind an injectable lookup; the client
// itself must never be touched in unit tests.
vi.mock("@otterdeploy/db", () => ({ db: {} }));

import type { OpenSession, SessionDimensions, SessionSignal } from "../sessionizer";

import {
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  applySignal,
  identifySession,
  resetSessionizer,
  sidHashOf,
  sweepIdleSessions,
  takeDirtySessions,
} from "../sessionizer";

const siteId = idSchema.analyticsSite.parse("asite_sessionizer");
const T0 = Date.UTC(2026, 7, 26, 12, 0, 0);

function dims(over: Partial<SessionDimensions> = {}): SessionDimensions {
  return {
    host: "example.com",
    referrerHost: "google.com",
    utmSource: "news",
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    country: "DE",
    browser: "Chrome",
    os: "Windows",
    device: "desktop",
    screenW: 1440,
    language: "en-gb",
    ...over,
  };
}

const key = { siteId, visitorId: "a".repeat(32), sidHash: sidHashOf(siteId, "tab-1") };

function pv(at: number, path = "/", d: Partial<SessionDimensions> = {}): SessionSignal {
  return { kind: "pv", at, path, dims: dims(d) };
}

const noDb = { lookupOpenSession: async () => null };

beforeEach(() => {
  resetSessionizer();
});

describe("sidHashOf", () => {
  test("16 hex, site-scoped", () => {
    expect(sidHashOf(siteId, "tab-1")).toMatch(/^[0-9a-f]{16}$/);
    expect(sidHashOf(siteId, "tab-1")).toBe(sidHashOf(siteId, "tab-1"));
    expect(sidHashOf(siteId, "tab-1")).not.toBe(sidHashOf(siteId, "tab-2"));
  });
});

describe("applySignal", () => {
  test("creates a session on first pageview with first-touch frozen", async () => {
    const s = await applySignal(key, pv(T0, "/landing"), noDb);
    expect(s.id.startsWith("ases_")).toBe(true);
    expect(s.pageviews).toBe(1);
    expect(s.entryPath).toBe("/landing");
    expect(s.exitPath).toBe("/landing");
    expect(s.referrerHost).toBe("google.com");
    expect(s.startedAt).toBe(T0);
    expect(s.dirty).toBe(true);
  });

  test("continues within the idle window; first-touch stays frozen", async () => {
    const first = await applySignal(key, pv(T0, "/landing"), noDb);
    const second = await applySignal(
      key,
      pv(T0 + 10 * 60_000, "/pricing", { referrerHost: null, utmSource: null }),
      noDb,
    );
    expect(second.id).toBe(first.id);
    expect(second.pageviews).toBe(2);
    expect(second.entryPath).toBe("/landing");
    expect(second.exitPath).toBe("/pricing");
    expect(second.referrerHost).toBe("google.com");
    expect(second.utmSource).toBe("news");
    expect(second.lastAt).toBe(T0 + 10 * 60_000);
  });

  test("starts a new session after 30 min idle", async () => {
    const first = await applySignal(key, pv(T0), noDb);
    const second = await applySignal(key, pv(T0 + SESSION_IDLE_MS + 1), noDb);
    expect(second.id).not.toBe(first.id);
    expect(second.pageviews).toBe(1);
  });

  test("caps a session at 24 h even under continuous activity", async () => {
    const first = await applySignal(key, pv(T0), noDb);
    let last: OpenSession = first;
    for (let at = T0 + 10 * 60_000; at <= T0 + SESSION_MAX_MS + 10 * 60_000; at += 10 * 60_000) {
      last = await applySignal(key, { kind: "hb", at, path: "/", dims: dims() }, noDb);
    }
    expect(last.id).not.toBe(first.id);
  });

  test("resumes the most recent open session from the DB on a memory miss", async () => {
    const resumed: OpenSession = {
      ...dims(),
      id: idSchema.analyticsSession.parse("ases_resumed"),
      siteId,
      visitorId: key.visitorId,
      externalUserId: null,
      startedAt: T0 - 5 * 60_000,
      lastAt: T0 - 60_000,
      pageviews: 3,
      events: 1,
      activeMs: 9_000,
      scroll: 40,
      entryPath: "/landing",
      exitPath: "/docs",
      dirty: false,
    };
    const lookup = vi.fn(async () => ({ ...resumed }));
    const s = await applySignal(key, pv(T0, "/pricing"), { lookupOpenSession: lookup });
    expect(lookup).toHaveBeenCalledWith(siteId, key.visitorId, T0);
    expect(s.id).toBe(resumed.id);
    expect(s.pageviews).toBe(4);
    expect(s.entryPath).toBe("/landing");
    expect(s.exitPath).toBe("/pricing");
    // Now cached: the next signal must not hit the DB again.
    await applySignal(key, pv(T0 + 1_000), { lookupOpenSession: lookup });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test("ignores a DB session already past the idle window", async () => {
    const stale = await applySignal(key, pv(T0 - SESSION_IDLE_MS - 60_000), noDb);
    resetSessionizer();
    const lookup = vi.fn(async () => ({ ...stale, dirty: false }));
    const fresh = await applySignal(key, pv(T0), { lookupOpenSession: lookup });
    expect(fresh.id).not.toBe(stale.id);
    expect(fresh.pageviews).toBe(1);
  });

  test("engagement accumulates active time and keeps max scroll", async () => {
    await applySignal(key, pv(T0), noDb);
    await applySignal(
      key,
      { kind: "eng", at: T0 + 1_000, path: "/", dims: dims(), activeMs: 5_000, scroll: 40 },
      noDb,
    );
    const s = await applySignal(
      key,
      { kind: "eng", at: T0 + 2_000, path: "/", dims: dims(), activeMs: 7_000, scroll: 80 },
      noDb,
    );
    expect(s.activeMs).toBe(12_000);
    expect(s.scroll).toBe(80);
    const after = await applySignal(
      key,
      { kind: "eng", at: T0 + 3_000, path: "/", dims: dims(), activeMs: 0, scroll: 50 },
      noDb,
    );
    expect(after.scroll).toBe(80);
  });

  test("custom events count without touching exit path", async () => {
    await applySignal(key, pv(T0, "/landing"), noDb);
    const s = await applySignal(
      key,
      { kind: "ev", at: T0 + 500, path: "/landing", dims: dims() },
      noDb,
    );
    expect(s.events).toBe(1);
    expect(s.pageviews).toBe(1);
    expect(s.exitPath).toBe("/landing");
  });

  test("heartbeats bump lastAt and mark the session dirty (liveness)", async () => {
    await applySignal(key, pv(T0), noDb);
    takeDirtySessions(); // clear the creation dirt
    const s = await applySignal(
      key,
      { kind: "hb", at: T0 + 30_000, path: "/", dims: dims() },
      noDb,
    );
    expect(s.lastAt).toBe(T0 + 30_000);
    expect(s.pageviews).toBe(1);
    const rows = takeDirtySessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastAt.getTime()).toBe(T0 + 30_000);
  });
});

describe("identifySession", () => {
  test("attaches to the open session, false when there is none", async () => {
    expect(identifySession(key, "e".repeat(32), T0)).toBe(false);
    await applySignal(key, pv(T0), noDb);
    expect(identifySession(key, "e".repeat(32), T0 + 1_000)).toBe(true);
    const [row] = takeDirtySessions();
    expect(row?.externalUserId).toBe("e".repeat(32));
  });
});

describe("takeDirtySessions / sweepIdleSessions", () => {
  test("dirty sessions are drained once and swept only when idle and clean", async () => {
    await applySignal(key, pv(T0), noDb);
    expect(takeDirtySessions()).toHaveLength(1);
    expect(takeDirtySessions()).toHaveLength(0);

    // Idle but clean: swept. Dirty: kept for the next flush.
    expect(sweepIdleSessions(T0 + SESSION_IDLE_MS + 1)).toBe(1);
    await applySignal(key, pv(T0), noDb);
    expect(sweepIdleSessions(T0 + SESSION_IDLE_MS + 1)).toBe(0);
  });
});
