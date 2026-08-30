import { describe, expect, it } from "vitest";

import { isTrustedProxyEntry, parseTrustedProxyList, trustedProxyLines } from "../trusted-proxies";

describe("parseTrustedProxyList", () => {
  it("accepts commas, spaces and newlines interchangeably", () => {
    expect(parseTrustedProxyList("10.0.0.0/8, 172.16.0.0/12\n192.168.0.0/16")).toEqual([
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
    ]);
  });

  it("drops empty entries left by trailing separators", () => {
    expect(parseTrustedProxyList("10.0.0.0/8,\n\n")).toEqual(["10.0.0.0/8"]);
  });
});

describe("isTrustedProxyEntry", () => {
  it("accepts addresses and CIDRs, v4 and v6", () => {
    expect(isTrustedProxyEntry("172.64.0.0/13")).toBe(true);
    expect(isTrustedProxyEntry("2606:4700::/32")).toBe(true);
    expect(isTrustedProxyEntry("198.41.128.5")).toBe(true);
  });

  it("rejects anything that could escape the directive", () => {
    // The value is written verbatim into a Caddyfile, so the charset is the
    // boundary: a newline or a brace would end the stanza early.
    expect(isTrustedProxyEntry("10.0.0.0/8\n}")).toBe(false);
    expect(isTrustedProxyEntry("example.com")).toBe(false);
    expect(isTrustedProxyEntry("10.0.0.0/8 evil")).toBe(false);
  });
});

describe("trustedProxyLines", () => {
  it("emits nothing when unconfigured, so a direct install keeps Caddy's default", () => {
    expect(trustedProxyLines(null)).toEqual([]);
    expect(trustedProxyLines("")).toEqual([]);
    expect(trustedProxyLines("   ")).toEqual([]);
  });

  it("pairs the trust list with the header list — neither is safe alone", () => {
    expect(trustedProxyLines("173.245.48.0/20 2606:4700::/32")).toEqual([
      "\tservers {",
      "\t\ttrusted_proxies static 173.245.48.0/20 2606:4700::/32",
      "\t\tclient_ip_headers Cf-Connecting-Ip X-Forwarded-For",
      "\t}",
    ]);
  });

  it("drops entries that don't parse rather than failing the whole render", () => {
    // A typo in this field must not take the edge config down with it, and an
    // untrusted hop is the safe direction to fail.
    expect(trustedProxyLines("10.0.0.0/8, nonsense")).toEqual([
      "\tservers {",
      "\t\ttrusted_proxies static 10.0.0.0/8",
      "\t\tclient_ip_headers Cf-Connecting-Ip X-Forwarded-For",
      "\t}",
    ]);
  });

  it("emits nothing when every entry is invalid", () => {
    expect(trustedProxyLines("nonsense, also-nonsense")).toEqual([]);
  });
});
