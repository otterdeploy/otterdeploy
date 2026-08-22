import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SIGN_IN_METHODS,
  isAuthPathAllowed,
  methodForAuthPath,
  type SignInMethods,
  wouldLockOut,
} from "../sign-in-methods";

const all: SignInMethods = { password: true, passkey: true, sso: true };
const off = (patch: Partial<SignInMethods>): SignInMethods => ({
  ...all,
  ...patch,
});

describe("which method owns a path", () => {
  test("claims the password surfaces, including sign-up and reset", () => {
    expect(methodForAuthPath("/sign-in/email")).toBe("password");
    expect(methodForAuthPath("/sign-up/email")).toBe("password");
    expect(methodForAuthPath("/request-password-reset")).toBe("password");
    expect(methodForAuthPath("/reset-password")).toBe("password");
  });

  test("claims every passkey route by prefix", () => {
    expect(methodForAuthPath("/passkey/generate-authenticate-options")).toBe("passkey");
    expect(methodForAuthPath("/passkey/verify-authentication")).toBe("passkey");
    expect(methodForAuthPath("/passkey/delete-passkey")).toBe("passkey");
  });

  test("claims the SSO sign-in and callback paths", () => {
    expect(methodForAuthPath("/sign-in/sso")).toBe("sso");
    expect(methodForAuthPath("/sso/callback")).toBe("sso");
    expect(methodForAuthPath("/sso/callback/acme-okta")).toBe("sso");
    expect(methodForAuthPath("/sso/saml2/sp/metadata")).toBe("sso");
  });

  test("leaves SSO PROVISIONING alone, so a provider can be configured before the switch is flipped", () => {
    expect(methodForAuthPath("/sso/register")).toBeNull();
    expect(methodForAuthPath("/sso/providers")).toBeNull();
    expect(methodForAuthPath("/sso/delete")).toBeNull();
  });

  test("leaves everything that is not a sign-in surface alone", () => {
    for (const path of [
      "/get-session",
      "/sign-out",
      "/change-password",
      "/sign-in/social",
      "/callback/github",
      "/device/token",
      "/organization/invite-member",
      "/two-factor/verify-totp",
    ]) {
      expect(methodForAuthPath(path)).toBeNull();
    }
  });
});

describe("gating a request", () => {
  test("lets a disabled method's path through on nothing else", () => {
    expect(
      isAuthPathAllowed({
        path: "/sign-in/email",
        methods: off({ password: false }),
        bootstrapComplete: true,
      }),
    ).toBe(false);
    expect(
      isAuthPathAllowed({
        path: "/passkey/verify-authentication",
        methods: off({ passkey: false }),
        bootstrapComplete: true,
      }),
    ).toBe(false);
    expect(
      isAuthPathAllowed({
        path: "/sso/callback/acme",
        methods: off({ sso: false }),
        bootstrapComplete: true,
      }),
    ).toBe(false);
  });

  test("never gates a path that belongs to no method", () => {
    const nothing: SignInMethods = {
      password: false,
      passkey: false,
      sso: false,
    };
    expect(
      isAuthPathAllowed({
        path: "/get-session",
        methods: nothing,
        bootstrapComplete: true,
      }),
    ).toBe(true);
    expect(
      isAuthPathAllowed({
        path: "/sign-out",
        methods: nothing,
        bootstrapComplete: true,
      }),
    ).toBe(true);
  });

  test("forces passwords on until the first account exists", () => {
    // Otherwise an install restored from a pre-bootstrap dump with passwords
    // disabled has no way in at all: the bootstrap token only travels through
    // /sign-up/email.
    expect(
      isAuthPathAllowed({
        path: "/sign-up/email",
        methods: off({ password: false }),
        bootstrapComplete: false,
      }),
    ).toBe(true);
    expect(
      isAuthPathAllowed({
        path: "/sign-in/email",
        methods: off({ password: false }),
        bootstrapComplete: false,
      }),
    ).toBe(true);
  });

  test("the bootstrap exception covers passwords only", () => {
    expect(
      isAuthPathAllowed({
        path: "/passkey/verify-authentication",
        methods: off({ passkey: false }),
        bootstrapComplete: false,
      }),
    ).toBe(false);
  });
});

describe("the lock-out floor", () => {
  const counts = { liveSocialProviderCount: 0, registeredSsoProviderCount: 0 };

  test("passwords on is always safe", () => {
    expect(wouldLockOut({ methods: all, ...counts })).toBe(false);
    expect(wouldLockOut({ methods: off({ passkey: false, sso: false }), ...counts })).toBe(false);
  });

  test("refuses passwords off with nothing federated behind it", () => {
    expect(wouldLockOut({ methods: off({ password: false }), ...counts })).toBe(true);
  });

  test("a live social provider is enough to allow passwords off", () => {
    expect(
      wouldLockOut({
        methods: off({ password: false }),
        liveSocialProviderCount: 1,
        registeredSsoProviderCount: 0,
      }),
    ).toBe(false);
  });

  test("SSO counts only when it is switched on AND a provider is registered", () => {
    expect(
      wouldLockOut({
        methods: off({ password: false }),
        liveSocialProviderCount: 0,
        registeredSsoProviderCount: 2,
      }),
    ).toBe(false);
    // Registered but switched off: the buttons are gone, so it admits nobody.
    expect(
      wouldLockOut({
        methods: off({ password: false, sso: false }),
        liveSocialProviderCount: 0,
        registeredSsoProviderCount: 2,
      }),
    ).toBe(true);
    // Switched on with nothing registered: same result, no provider to reach.
    expect(
      wouldLockOut({
        methods: off({ password: false }),
        liveSocialProviderCount: 0,
        registeredSsoProviderCount: 0,
      }),
    ).toBe(true);
  });

  test("passkeys alone are never a substitute for passwords", () => {
    // A passkey is per-user: an account that never registered one cannot sign
    // in to register one.
    expect(
      wouldLockOut({
        methods: { password: false, passkey: true, sso: false },
        ...counts,
      }),
    ).toBe(true);
  });
});

describe("defaults", () => {
  test("fail open, so a settings read failure cannot lock an operator out", () => {
    expect(DEFAULT_SIGN_IN_METHODS).toEqual({
      password: true,
      passkey: true,
      sso: true,
    });
  });
});
