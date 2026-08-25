/**
 * The two rules behind "an edited generated domain must actually apply":
 *
 * `platformApexFor` decides whether a hostname sits under an apex the
 * platform already vouches for (org base / project custom domain). Renaming
 * a generated route WITHIN such an apex keeps the generated trust model —
 * the fix for the edit that silently flipped a serving generated host into a
 * disabled, TXT-gated custom one.
 *
 * `normalizePublicHostInput` turns whatever an operator typed into a URL-ish
 * field (scheme, path, port) into the bare hostname the compose exposed-seed
 * publishes at.
 */

import { describe, expect, it } from "vite-plus/test";

import { normalizePublicHostInput, platformApexFor } from "../domain-rules";

const sources = {
  projectCustomDomain: "proj.example.com",
  projectCustomDomainVerifiedAt: new Date("2026-01-01"),
  orgBaseDomain: "dr34mw0rk5.com",
  orgBaseDomainVerifiedAt: null,
  localBaseDomain: "otterdeploy.localhost",
};

describe("platformApexFor", () => {
  it("matches a subdomain of the org base domain and carries its verification", () => {
    expect(platformApexFor("netbird.dr34mw0rk5.com", sources)).toEqual({
      source: "org-base",
      verified: false,
    });
  });

  it("project custom domain outranks the org base and reads verified", () => {
    expect(platformApexFor("api.proj.example.com", sources)).toEqual({
      source: "project-custom",
      verified: true,
    });
  });

  it("the apex itself is not a subdomain of the apex", () => {
    // Routing the bare base domain is a deliberate custom-domain decision,
    // not a rename within the platform's namespace.
    expect(platformApexFor("dr34mw0rk5.com", sources)).toBeNull();
  });

  it("a lookalike suffix does not match (evildr34mw0rk5.com)", () => {
    expect(platformApexFor("a.evildr34mw0rk5.com", sources)).toBeNull();
  });

  it("unrelated hosts and null sources fall through to custom-domain rules", () => {
    expect(platformApexFor("app.elsewhere.io", sources)).toBeNull();
    expect(platformApexFor("netbird.dr34mw0rk5.com", null)).toBeNull();
  });

  it("dev local wildcard matches but is never verified", () => {
    expect(platformApexFor("web-store.otterdeploy.localhost", sources)).toEqual({
      source: "local-base",
      verified: false,
    });
  });
});

describe("normalizePublicHostInput", () => {
  it("passes a bare hostname through lowercased", () => {
    expect(normalizePublicHostInput("Netbird.DR34MW0RK5.com")).toBe("netbird.dr34mw0rk5.com");
  });

  it("strips scheme, path, port, and trailing dot", () => {
    expect(normalizePublicHostInput("https://netbird.dr34mw0rk5.com/")).toBe(
      "netbird.dr34mw0rk5.com",
    );
    expect(normalizePublicHostInput("https://app.example.com:8443/setup?x=1")).toBe(
      "app.example.com",
    );
    expect(normalizePublicHostInput("app.example.com.")).toBe("app.example.com");
  });

  it("rejects values with no usable hostname", () => {
    expect(normalizePublicHostInput("")).toBeNull();
    expect(normalizePublicHostInput("https://")).toBeNull();
    expect(normalizePublicHostInput("not a host")).toBeNull();
    // Reserved suffixes stay rejected by normalizeDomain.
    expect(normalizePublicHostInput("http://foo.invalid")).toBeNull();
  });
});
