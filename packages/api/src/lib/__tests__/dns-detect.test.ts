import { describe, expect, it } from "vite-plus/test";

import { providerFromNameservers, zoneCandidates } from "../dns-detect";

describe("zoneCandidates", () => {
  it("walks up from the longest name, so a delegated subzone wins over its parent", () => {
    // Longest-first matters: if dev.acme.com is delegated separately, its own
    // nameservers are the right answer, not acme.com's.
    expect(zoneCandidates("waves.dev.acme.com")).toEqual([
      "waves.dev.acme.com",
      "dev.acme.com",
      "acme.com",
    ]);
  });

  it("stops before a bare TLD", () => {
    // Querying "com" costs a round trip to learn nothing actionable.
    expect(zoneCandidates("acme.com")).toEqual(["acme.com"]);
    expect(zoneCandidates("com")).toEqual([]);
  });

  it("includes multi-part suffixes as candidates rather than guessing registrability", () => {
    // We are not parsing the public suffix list. We ask which label ANSWERS
    // NS. co.uk is a legitimate candidate to try; it simply won't be reached
    // because acme.co.uk answers first.
    expect(zoneCandidates("a.acme.co.uk")).toEqual(["a.acme.co.uk", "acme.co.uk", "co.uk"]);
  });

  it("normalizes case and a trailing dot", () => {
    expect(zoneCandidates("Waves.ACME.com.")).toEqual(["waves.acme.com", "acme.com"]);
  });
});

describe("providerFromNameservers", () => {
  it("detects Cloudflare", () => {
    expect(providerFromNameservers(["kate.ns.cloudflare.com", "rob.ns.cloudflare.com"])).toBe(
      "cloudflare",
    );
  });

  it("is case-insensitive and tolerates a single mixed nameserver set", () => {
    expect(providerFromNameservers(["ns1.example.net", "KATE.NS.CLOUDFLARE.COM"])).toBe(
      "cloudflare",
    );
  });

  it("returns unknown for other providers", () => {
    expect(providerFromNameservers(["ns-1.awsdns-01.org", "ns-2.awsdns-02.co.uk"])).toBe("unknown");
    expect(providerFromNameservers([])).toBe("unknown");
  });

  it("does not match a lookalike domain that merely ends in the brand name", () => {
    // `ns.cloudflare.com.evil.test` must not be read as Cloudflare. The suffix
    // check anchors on a label boundary, not a substring.
    expect(providerFromNameservers(["ns.cloudflare.com.evil.test"])).toBe("unknown");
    expect(providerFromNameservers(["notns.cloudflare.com.attacker.net"])).toBe("unknown");
  });
});
