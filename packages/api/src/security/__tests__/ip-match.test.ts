import { describe, expect, it } from "vitest";

import { coveredBy, ipMatcher } from "../ip-match";

describe("ipMatcher", () => {
  it("matches a bare address exactly", () => {
    const matches = ipMatcher("172.71.4.9");
    expect(matches?.("172.71.4.9")).toBe(true);
    expect(matches?.("172.71.4.10")).toBe(false);
  });

  it("matches inside a CIDR — the case a string compare misses", () => {
    const matches = ipMatcher("172.71.0.0/16");
    expect(matches?.("172.71.4.9")).toBe(true);
    expect(matches?.("172.72.4.9")).toBe(false);
  });

  it("handles IPv6 addresses and prefixes", () => {
    const matches = ipMatcher("2606:4700::/32");
    expect(matches?.("2606:4700:10::1")).toBe(true);
    expect(matches?.("2400:cb00::1")).toBe(false);
  });

  it("never matches across families", () => {
    expect(ipMatcher("10.0.0.0/8")?.("2606:4700::1")).toBe(false);
  });

  it("returns null for anything that isn't an address or CIDR", () => {
    expect(ipMatcher("not-an-ip")).toBeNull();
    expect(ipMatcher("10.0.0.0/mask")).toBeNull();
    expect(ipMatcher("10.0.0.0/33")).toBeNull();
    expect(ipMatcher("")).toBeNull();
  });
});

describe("coveredBy", () => {
  it("returns every candidate the target would also block", () => {
    expect(coveredBy("172.71.0.0/16", ["172.71.4.9", "8.8.8.8", "172.71.200.1"])).toEqual([
      "172.71.4.9",
      "172.71.200.1",
    ]);
  });

  it("is empty for an unparseable target, so callers must guard separately", () => {
    expect(coveredBy("garbage", ["172.71.4.9"])).toEqual([]);
  });
});
