import { describe, expect, test } from "bun:test";

import { canonicalWebOrigin } from "../canonical-origin";

const FALLBACK = "http://203.0.113.7:3000";

describe("canonicalWebOrigin", () => {
  test("verified control-plane domain wins over the env fallback", () => {
    expect(
      canonicalWebOrigin(
        { controlPlaneFqdn: "deploy.example.com", controlPlaneFqdnVerifiedAt: new Date() },
        FALLBACK,
      ),
    ).toBe("https://deploy.example.com");
  });

  test("unverified domain is NOT trusted — falls back to the env base", () => {
    expect(
      canonicalWebOrigin(
        { controlPlaneFqdn: "deploy.example.com", controlPlaneFqdnVerifiedAt: null },
        FALLBACK,
      ),
    ).toBe(FALLBACK);
  });

  test("no domain configured falls back to the env base", () => {
    expect(
      canonicalWebOrigin({ controlPlaneFqdn: null, controlPlaneFqdnVerifiedAt: null }, FALLBACK),
    ).toBe(FALLBACK);
  });

  test("missing platform_settings row (fresh install) falls back", () => {
    expect(canonicalWebOrigin(undefined, FALLBACK)).toBe(FALLBACK);
    expect(canonicalWebOrigin(null, FALLBACK)).toBe(FALLBACK);
  });

  test("stale verifiedAt without a domain still falls back", () => {
    expect(
      canonicalWebOrigin(
        { controlPlaneFqdn: null, controlPlaneFqdnVerifiedAt: new Date() },
        FALLBACK,
      ),
    ).toBe(FALLBACK);
  });

  test("fallback trailing slash is trimmed so path concatenation stays clean", () => {
    expect(canonicalWebOrigin(null, "https://web.example.com/")).toBe("https://web.example.com");
  });
});
