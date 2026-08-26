import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, test } from "vite-plus/test";

import { externalUserHash, utcDayOf, visitorHash } from "../identity";

const siteA = idSchema.analyticsSite.parse("asite_aaaaaaaaaaaa");
const siteB = idSchema.analyticsSite.parse("asite_bbbbbbbbbbbb");

const base = {
  siteId: siteA,
  utcDay: "2026-08-26",
  ip: "203.0.113.9",
  browser: "Chrome",
  os: "Windows",
  device: "desktop",
};

describe("visitorHash", () => {
  test("is deterministic and 32 lowercase hex chars", () => {
    const a = visitorHash(base);
    expect(a).toBe(visitorHash({ ...base }));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  test("rotates with the UTC day", () => {
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, utcDay: "2026-08-27" }));
  });

  test("is site-scoped", () => {
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, siteId: siteB }));
  });

  test("differs by ip and UA families", () => {
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, ip: "203.0.113.10" }));
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, browser: "Firefox" }));
  });
});

describe("externalUserHash", () => {
  test("is deterministic, site-scoped and 32 hex", () => {
    const a = externalUserHash(siteA, "user_123");
    expect(a).toBe(externalUserHash(siteA, "user_123"));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(externalUserHash(siteB, "user_123"));
    expect(a).not.toBe(externalUserHash(siteA, "user_124"));
  });

  test("uses a different key domain than visitorHash", () => {
    // Same message bytes through both paths must not collide: the HKDF info
    // strings separate the domains.
    const uid = `${base.utcDay}|${base.ip}|${base.browser}|${base.os}|${base.device}`;
    expect(externalUserHash(siteA, uid)).not.toBe(visitorHash(base));
  });
});

describe("utcDayOf", () => {
  test("returns the UTC calendar day", () => {
    expect(utcDayOf(Date.UTC(2026, 7, 26, 12, 0, 0))).toBe("2026-08-26");
    // 23:59 UTC stays on the same day; +2 min rolls over.
    expect(utcDayOf(Date.UTC(2026, 7, 26, 23, 59, 0))).toBe("2026-08-26");
    expect(utcDayOf(Date.UTC(2026, 7, 26, 23, 59, 0) + 120_000)).toBe("2026-08-27");
  });
});
