import { describe, expect, test } from "bun:test";

import {
  baseDomainPattern,
  CHANNELS,
  classifyChannel,
  isSearchHost,
  isSocialHost,
  isVideoHost,
  matchesBaseDomain,
} from "../channels";

function channel(
  referrerHost: string | null,
  utmSource: string | null = null,
  utmMedium: string | null = null,
) {
  return classifyChannel({ referrerHost, utmSource, utmMedium });
}

describe("classifyChannel: utm_medium table", () => {
  test("paid-search mediums", () => {
    for (const m of ["cpc", "ppc", "paid", "paidsearch", "retargeting"]) {
      expect(channel(null, "google", m)).toBe("Paid Search");
    }
  });

  test("a paid medium with a social source is Paid Social", () => {
    expect(channel(null, "facebook", "cpc")).toBe("Paid Social");
    expect(channel(null, "tiktok", "paid")).toBe("Paid Social");
    // Source given as a host rather than a name still counts.
    expect(channel(null, "instagram.com", "ppc")).toBe("Paid Social");
    // ... and so does a social referrer with a non-social source.
    expect(channel("l.facebook.com", null, "cpc")).toBe("Paid Social");
  });

  test("display, email, affiliate, social, video mediums", () => {
    for (const m of ["display", "banner", "cpm"]) expect(channel(null, null, m)).toBe("Display");
    for (const m of ["email", "e-mail", "newsletter"]) expect(channel(null, null, m)).toBe("Email");
    expect(channel(null, "partner", "affiliate")).toBe("Affiliate");
    for (const m of ["social", "social-network", "sm"]) {
      expect(channel(null, null, m)).toBe("Organic Social");
    }
    expect(channel(null, null, "video")).toBe("Video");
  });

  test("medium is case/whitespace-insensitive", () => {
    expect(channel(null, null, " CPC ")).toBe("Paid Search");
  });
});

describe("classifyChannel: referrer host", () => {
  test("search engines, exact and subdomain", () => {
    expect(channel("duckduckgo.com")).toBe("Organic Search");
    expect(channel("www.bing.com")).toBe("Organic Search");
    expect(channel("search.brave.com")).toBe("Organic Search");
  });

  test("base-domain engines match any country suffix", () => {
    for (const h of ["google.com", "www.google.co.uk", "yahoo.co.jp", "yandex.ru"]) {
      expect(channel(h)).toBe("Organic Search");
    }
    // But not a lookalike label.
    expect(channel("notgoogle.com")).toBe("Referral");
    expect(channel("google.com.evil.example")).toBe("Referral");
  });

  test("social hosts (pinterest by base domain)", () => {
    for (const h of ["facebook.com", "m.facebook.com", "t.co", "news.ycombinator.com"]) {
      expect(channel(h)).toBe("Organic Social");
    }
    expect(channel("pinterest.co.uk")).toBe("Organic Social");
  });

  test("video hosts", () => {
    expect(channel("youtube.com")).toBe("Video");
    expect(channel("www.youtube.com")).toBe("Video");
    expect(channel("vimeo.com")).toBe("Video");
  });

  test("an unknown referrer is Referral", () => {
    expect(channel("example.com")).toBe("Referral");
  });
});

describe("classifyChannel: fallthrough", () => {
  test("no referrer and no utm is Direct", () => {
    expect(channel(null)).toBe("Direct");
    expect(channel("", "", "")).toBe("Direct");
  });

  test("utm_source without a medium is Referral", () => {
    expect(channel(null, "some-partner")).toBe("Referral");
  });

  test("an unknown medium is Referral, never Other", () => {
    expect(channel(null, null, "sponsorship")).toBe("Referral");
    expect(CHANNELS).toContain("Other");
  });
});

describe("host matchers", () => {
  test("matchesBaseDomain accepts one or two suffix labels only", () => {
    expect(matchesBaseDomain("google.com", "google")).toBe(true);
    expect(matchesBaseDomain("google.com.au", "google")).toBe(true);
    expect(matchesBaseDomain("google.example.longsuffix", "google")).toBe(false);
  });

  test("baseDomainPattern stays POSIX-ERE-safe (no JS-only syntax)", () => {
    expect(baseDomainPattern("google")).not.toMatch(/\\d|\\w|\(\?/);
  });

  test("list membership helpers agree with classification", () => {
    expect(isSearchHost("kagi.com")).toBe(true);
    expect(isSocialHost("bsky.app")).toBe(true);
    expect(isVideoHost("youtu.be")).toBe(true);
    expect(isSearchHost("example.com")).toBe(false);
  });
});
