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
});
