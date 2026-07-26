import { describe, expect, test } from "bun:test";

import { decideRegistration, isSsoCallbackPath } from "../registration-policy";

const token = "bootstrap-token-with-at-least-thirty-two-characters";

describe("registration admission", () => {
  test("requires the configured token for the first account", () => {
    expect(
      decideRegistration({
        bootstrapComplete: false,
        hasPendingInvitation: false,
        authPath: "/sign-up/email",
        configuredBootstrapToken: token,
        presentedBootstrapToken: undefined,
      }),
    ).toEqual({ allowed: false, reason: "bootstrap-token-missing" });
  });

  test("rejects an invalid bootstrap token", () => {
    expect(
      decideRegistration({
        bootstrapComplete: false,
        hasPendingInvitation: false,
        authPath: "/sign-up/email",
        configuredBootstrapToken: token,
        presentedBootstrapToken: `${token}-wrong`,
      }),
    ).toEqual({ allowed: false, reason: "bootstrap-token-invalid" });
  });

  test("does not bootstrap through an OAuth callback", () => {
    expect(
      decideRegistration({
        bootstrapComplete: false,
        hasPendingInvitation: false,
        authPath: "/callback/github",
        configuredBootstrapToken: token,
        presentedBootstrapToken: token,
      }),
    ).toEqual({ allowed: false, reason: "bootstrap-token-missing" });
  });

  test("makes the token-authorized first account installation admin", () => {
    expect(
      decideRegistration({
        bootstrapComplete: false,
        hasPendingInvitation: false,
        authPath: "/sign-up/email",
        configuredBootstrapToken: token,
        presentedBootstrapToken: token,
      }),
    ).toEqual({ allowed: true, installAdmin: true });
  });

  test("allows only pending invitees after bootstrap", () => {
    expect(
      decideRegistration({
        bootstrapComplete: true,
        hasPendingInvitation: true,
        authPath: "/sign-up/email",
        configuredBootstrapToken: token,
        presentedBootstrapToken: undefined,
      }),
    ).toEqual({ allowed: true, installAdmin: false });

    expect(
      decideRegistration({
        bootstrapComplete: true,
        hasPendingInvitation: false,
        authPath: "/sign-up/email",
        configuredBootstrapToken: token,
        presentedBootstrapToken: token,
      }),
    ).toEqual({ allowed: false, reason: "invite-required" });
  });

  test("open registration admits an uninvited account after bootstrap", () => {
    expect(
      decideRegistration({
        bootstrapComplete: true,
        hasPendingInvitation: false,
        authPath: "/sign-up/email",
        configuredBootstrapToken: token,
        presentedBootstrapToken: undefined,
        openRegistration: true,
      }),
    ).toEqual({ allowed: true, installAdmin: false });
  });

  test("open registration never confers installation admin", () => {
    // Even presenting the real bootstrap token: bootstrap is already complete,
    // so this is an ordinary self-registration and must stay a plain member.
    expect(
      decideRegistration({
        bootstrapComplete: true,
        hasPendingInvitation: false,
        authPath: "/sign-up/email",
        configuredBootstrapToken: token,
        presentedBootstrapToken: token,
        openRegistration: true,
      }),
    ).toEqual({ allowed: true, installAdmin: false });
  });

  test("open registration does not unlock the first account", () => {
    // The installer token is the only thing that can create the owner, so an
    // install whose DB says "open" but has no users is still bootstrap-gated.
    expect(
      decideRegistration({
        bootstrapComplete: false,
        hasPendingInvitation: false,
        authPath: "/sign-up/email",
        configuredBootstrapToken: token,
        presentedBootstrapToken: undefined,
        openRegistration: true,
      }),
    ).toEqual({ allowed: false, reason: "bootstrap-token-missing" });
  });

  test("omitting the flag falls back to invite-only", () => {
    expect(
      decideRegistration({
        bootstrapComplete: true,
        hasPendingInvitation: false,
        authPath: "/sign-up/email",
        configuredBootstrapToken: token,
        presentedBootstrapToken: undefined,
      }),
    ).toEqual({ allowed: false, reason: "invite-required" });
  });

  test("an SSO provider vouching admits a first-time user on a closed install", () => {
    // The point of the feature: an operator who wired acme.com to their Okta
    // tenant said "people from this tenant may sign in". Requiring an
    // individual invitation on top of that would make SSO useless.
    expect(
      decideRegistration({
        bootstrapComplete: true,
        hasPendingInvitation: false,
        authPath: "/sso/callback/okta",
        configuredBootstrapToken: token,
        presentedBootstrapToken: undefined,
        openRegistration: false,
        ssoProviderVouches: true,
      }),
    ).toEqual({ allowed: true, installAdmin: false });
  });

  test("an SSO-provisioned account never becomes install admin", () => {
    // An IdP asserts identity, not authority over this installation.
    const decision = decideRegistration({
      bootstrapComplete: true,
      hasPendingInvitation: false,
      authPath: "/sso/callback/okta",
      configuredBootstrapToken: token,
      presentedBootstrapToken: token,
      ssoProviderVouches: true,
    });
    expect(decision).toEqual({ allowed: true, installAdmin: false });
  });

  test("SSO cannot create the FIRST account even when it vouches", () => {
    // Pre-bootstrap is email/password-only — an OAuth callback can't carry the
    // one-time installer token, so an SSO callback must not seize ownership of
    // a fresh install.
    expect(
      decideRegistration({
        bootstrapComplete: false,
        hasPendingInvitation: false,
        authPath: "/sso/callback/okta",
        configuredBootstrapToken: token,
        presentedBootstrapToken: token,
        ssoProviderVouches: true,
      }),
    ).toEqual({ allowed: false, reason: "bootstrap-token-missing" });
  });

  test("omitting the SSO flag leaves a closed install closed", () => {
    expect(
      decideRegistration({
        bootstrapComplete: true,
        hasPendingInvitation: false,
        authPath: "/sso/callback/okta",
        configuredBootstrapToken: token,
        presentedBootstrapToken: undefined,
      }),
    ).toEqual({ allowed: false, reason: "invite-required" });
  });
});

describe("isSsoCallbackPath", () => {
  test("accepts the plugin's OIDC and SAML callbacks", () => {
    expect(isSsoCallbackPath("/sso/callback/okta")).toBe(true);
    expect(isSsoCallbackPath("/sso/callback")).toBe(true);
    expect(isSsoCallbackPath("/sso/saml2/callback/okta")).toBe(true);
    expect(isSsoCallbackPath("/sso/saml2/sp/acs/okta")).toBe(true);
  });

  test("rejects everything else, including SSO registration itself", () => {
    // This is the half of the gate that stops someone self-registering at an
    // SSO'd domain through the ordinary signup form without meeting the IdP.
    expect(isSsoCallbackPath("/sign-up/email")).toBe(false);
    expect(isSsoCallbackPath("/sign-in/email")).toBe(false);
    expect(isSsoCallbackPath("/sign-in/social")).toBe(false);
    // Registering a provider is an authenticated admin action, not a signup.
    expect(isSsoCallbackPath("/sso/register")).toBe(false);
    expect(isSsoCallbackPath("/sso/providers")).toBe(false);
    expect(isSsoCallbackPath(undefined)).toBe(false);
  });

  test("is not fooled by a path that merely mentions the callback", () => {
    // Prefix-matching is deliberate, but it must anchor at the start — a
    // crafted path that embeds the callback later must not pass.
    expect(isSsoCallbackPath("/sign-up/email?next=/sso/callback/okta")).toBe(false);
    expect(isSsoCallbackPath("/evil/sso/callback/okta")).toBe(false);
  });
});
