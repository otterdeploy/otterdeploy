import { describe, expect, test } from "bun:test";

import { decideRegistration } from "../registration-policy";

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
});
