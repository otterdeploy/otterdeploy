import { describe, expect, test } from "vite-plus/test";

import { createRateLimiter, isIpAllowed, isValidAllowlistEntry } from "../inbound-guard";

describe("isValidAllowlistEntry", () => {
  test("accepts IPv4, IPv4 CIDR, and IPv6 literals", () => {
    expect(isValidAllowlistEntry("140.82.112.10")).toBe(true);
    expect(isValidAllowlistEntry("140.82.112.0/20")).toBe(true);
    expect(isValidAllowlistEntry("0.0.0.0/0")).toBe(true);
    expect(isValidAllowlistEntry("2001:db8::1")).toBe(true);
  });

  test("rejects garbage, out-of-range octets, and bad prefixes", () => {
    expect(isValidAllowlistEntry("")).toBe(false);
    expect(isValidAllowlistEntry("example.com")).toBe(false);
    expect(isValidAllowlistEntry("300.1.1.1")).toBe(false);
    expect(isValidAllowlistEntry("10.0.0.0/33")).toBe(false);
    expect(isValidAllowlistEntry("10.0.0.0/8/8")).toBe(false);
    expect(isValidAllowlistEntry("10.0.0.0/-1")).toBe(false);
  });
});

describe("isIpAllowed", () => {
  test("empty allowlist allows any source, including unknown IP", () => {
    expect(isIpAllowed("1.2.3.4", [])).toBe(true);
    expect(isIpAllowed(null, [])).toBe(true);
  });

  test("unknown caller IP fails closed when a list is configured", () => {
    expect(isIpAllowed(null, ["1.2.3.4"])).toBe(false);
  });

  test("exact IPv4 match", () => {
    expect(isIpAllowed("54.187.205.235", ["54.187.205.235"])).toBe(true);
    expect(isIpAllowed("54.187.205.236", ["54.187.205.235"])).toBe(false);
  });

  test("IPv4 CIDR match (GitHub hooks range)", () => {
    // 140.82.112.0/20 covers 140.82.112.0 – 140.82.127.255.
    expect(isIpAllowed("140.82.112.1", ["140.82.112.0/20"])).toBe(true);
    expect(isIpAllowed("140.82.127.255", ["140.82.112.0/20"])).toBe(true);
    expect(isIpAllowed("140.82.128.1", ["140.82.112.0/20"])).toBe(false);
  });

  test("/0 matches everything, /32 matches exactly one address", () => {
    expect(isIpAllowed("9.9.9.9", ["0.0.0.0/0"])).toBe(true);
    expect(isIpAllowed("10.0.0.1", ["10.0.0.1/32"])).toBe(true);
    expect(isIpAllowed("10.0.0.2", ["10.0.0.1/32"])).toBe(false);
  });

  test("any-of semantics across multiple entries", () => {
    const list = ["140.82.112.0/20", "54.187.205.235"];
    expect(isIpAllowed("54.187.205.235", list)).toBe(true);
    expect(isIpAllowed("140.82.113.9", list)).toBe(true);
    expect(isIpAllowed("8.8.8.8", list)).toBe(false);
  });

  test("IPv4-mapped IPv6 callers match their IPv4 allowlist entry", () => {
    expect(isIpAllowed("::ffff:140.82.112.1", ["140.82.112.0/20"])).toBe(true);
  });

  test("IPv6 exact match, case-insensitive", () => {
    expect(isIpAllowed("2001:DB8::1", ["2001:db8::1"])).toBe(true);
    expect(isIpAllowed("2001:db8::2", ["2001:db8::1"])).toBe(false);
  });
});

describe("createRateLimiter", () => {
  test("allows up to the limit, then denies within the window", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    expect(limiter.allow("tok")).toBe(true);
    expect(limiter.allow("tok")).toBe(true);
    expect(limiter.allow("tok")).toBe(true);
    expect(limiter.allow("tok")).toBe(false);
  });

  test("window slides — old hits expire and free capacity", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => t });
    expect(limiter.allow("tok")).toBe(true);
    t = 400;
    expect(limiter.allow("tok")).toBe(true);
    t = 900;
    expect(limiter.allow("tok")).toBe(false);
    // First hit (t=0) falls out of the window at t > 1000.
    t = 1_100;
    expect(limiter.allow("tok")).toBe(true);
  });

  test("keys are independent", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => t });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    expect(limiter.allow("b")).toBe(true);
  });
});
