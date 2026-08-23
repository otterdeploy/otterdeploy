import { describe, expect, test } from "bun:test";

import { ANY_HTTPS_ORIGIN, mayReachExternalIdp } from "../idp-trust";

const DASHBOARD = "https://otterdeploy.example.com";
const trusted = [DASHBOARD];

describe("reaching an external identity provider", () => {
  test("a real dashboard request on a discovery path may", () => {
    for (const path of [
      "/sso/register",
      "/sso/update-provider",
      "/sign-in/sso",
      "/sso/callback",
      "/sso/callback/acme-okta",
    ]) {
      expect(mayReachExternalIdp({ path, origin: DASHBOARD, trusted })).toBe(true);
    }
  });

  // THE attack. A page at evil.com POSTs to /sso/register with the operator's
  // cookies (SameSite=None over HTTPS, so they are sent cross-site). If the
  // widening happened before the origin was checked, evil.com would become
  // trusted for its own request, the CSRF check would pass, and an IdP that
  // authenticates as anyone at the claimed domain would be registered.
  test("a cross-origin page may NOT, even on a discovery path", () => {
    expect(
      mayReachExternalIdp({ path: "/sso/register", origin: "https://evil.com", trusted }),
    ).toBe(false);
  });

  test("the check reads the pre-widening list, so it cannot admit itself", () => {
    // Handing it a list that already contains the wildcard must not make an
    // untrusted origin pass: the caller passes `trusted` before widening, and
    // this pins that an attacker origin still fails on its own merits.
    expect(
      mayReachExternalIdp({
        path: "/sso/register",
        origin: "https://evil.com",
        trusted: [DASHBOARD, ANY_HTTPS_ORIGIN],
      }),
    ).toBe(false);
  });

  // A browser cannot suppress Origin on a cross-origin POST, so its absence is
  // a CLI/bearer caller (already holding a credential) or the top-level
  // redirect back from the IdP, which carries no origin.
  test("a request with no Origin may", () => {
    expect(mayReachExternalIdp({ path: "/sso/callback", origin: null, trusted })).toBe(true);
  });

  test("an opaque `null` Origin is treated as absent", () => {
    // Cross-site top-level redirects and sandboxed contexts send the literal
    // string "null"; the IdP redirect back to /sso/callback is exactly that.
    expect(mayReachExternalIdp({ path: "/sso/callback", origin: "null", trusted })).toBe(true);
  });

  test("never widens on a path that does not fetch an IdP", () => {
    for (const path of [
      "/sso/providers",
      "/sso/get-provider",
      "/sso/delete-provider",
      "/sso/verify-domain",
      "/sign-in/email",
      "/get-session",
      "/organization/invite-member",
    ]) {
      expect(mayReachExternalIdp({ path, origin: DASHBOARD, trusted })).toBe(false);
      expect(mayReachExternalIdp({ path, origin: null, trusted })).toBe(false);
    }
  });

  // Prefix matching must not let a lookalike path through.
  test("does not match a path that merely starts with a discovery path's name", () => {
    expect(mayReachExternalIdp({ path: "/sso/registerish", origin: null, trusted })).toBe(false);
  });
});

describe("the wildcard itself", () => {
  // Pinned against better-auth's matchesOriginPattern, which compares a
  // pattern containing `*` and `://` to the URL's origin.
  test("is https-only, so a cleartext internal target stays out of reach", () => {
    expect(ANY_HTTPS_ORIGIN).toBe("https://*");
    expect(ANY_HTTPS_ORIGIN.startsWith("https://")).toBe(true);
  });
});
