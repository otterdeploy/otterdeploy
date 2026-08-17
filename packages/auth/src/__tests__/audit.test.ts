import { APIError } from "better-auth/api";
import { describe, expect, test } from "vite-plus/test";

import { auditEntryForPath, classifyAuthOutcome } from "../audit-policy";

describe("auditEntryForPath", () => {
  test("audits the events an auth trail exists to answer", () => {
    for (const path of [
      "/sign-in/email",
      "/sign-out",
      "/reset-password",
      "/change-password",
      "/revoke-session",
      "/two-factor/disable",
      "/device/approve",
      "/api-key/create",
      "/organization/invite-member",
      "/organization/update-member-role",
      "/organization/remove-member",
    ]) {
      expect(auditEntryForPath(path)?.action, path).toBeTruthy();
    }
  });

  // The reason this is an allowlist. `/get-session` fires on every page load and
  // every RPC context build; auditing it would outnumber real events by orders
  // of magnitude and bury them: the same failure the oRPC read gate hit once
  // (packages/api/src/__tests__/audit-read-gate.test.ts).
  test("does not audit reads or session polling", () => {
    for (const path of [
      "/get-session",
      "/list-sessions",
      "/list-accounts",
      "/organization/list",
      "/organization/list-members",
      "/organization/set-active",
      "/api-key/list",
      "/api-key/get",
      "/ok",
    ]) {
      expect(auditEntryForPath(path), path).toBeNull();
    }
  });

  // Social sign-in completes at a provider-specific path, so an exact-match-only
  // lookup would silently drop every OAuth sign-in from the trail.
  test("resolves the social callback by prefix, whatever the provider", () => {
    expect(auditEntryForPath("/callback/github")?.action).toBe("auth.signInSocialCallback");
    expect(auditEntryForPath("/callback/google")?.action).toBe("auth.signInSocialCallback");
  });

  // A waiting CLI polls this every few seconds and is told "not yet" each time.
  // Those refusals are protocol, not security events.
  test("the polled device-token endpoint is success-only", () => {
    expect(auditEntryForPath("/device/token")?.successOnly).toBe(true);
    expect(auditEntryForPath("/device/approve")?.successOnly).toBeUndefined();
  });

  // Structural guard on rule 2 of the module: only identifiers ever come out of
  // a request body. Passwords, reset tokens, TOTP and backup codes all pass
  // through these endpoints, so a credential-shaped field name must never be
  // added to a `detailFields` list.
  test("no allowlisted body field is credential-shaped", () => {
    const forbidden = /pass|secret|token|code|key$|credential/i;
    const paths = [
      "/sign-in/email",
      "/sign-in/social",
      "/api-key/update",
      "/api-key/delete",
      "/organization/invite-member",
      "/organization/update-member-role",
      "/organization/cancel-invitation",
      "/organization/create-role",
      "/organization/update-role",
      "/organization/delete-role",
    ];
    for (const path of paths) {
      for (const field of auditEntryForPath(path)?.detailFields ?? []) {
        expect(forbidden.test(field), `${path} → ${field}`).toBe(false);
      }
    }
  });
});

describe("classifyAuthOutcome", () => {
  test("a normal return is a success", () => {
    expect(classifyAuthOutcome({ token: "…" })).toEqual({ outcome: "success" });
    expect(classifyAuthOutcome(undefined)).toEqual({ outcome: "success" });
  });

  // A wrong password is a refusal, not a malfunction: it belongs in the same
  // bucket as an RBAC denial so the two read alike and both feed the
  // denial-burst anomaly rule.
  test("401 and 403 are denials", () => {
    expect(classifyAuthOutcome(new APIError("UNAUTHORIZED", { message: "Invalid" })).outcome).toBe(
      "denied",
    );
    expect(classifyAuthOutcome(new APIError("FORBIDDEN", { message: "Nope" })).outcome).toBe(
      "denied",
    );
  });

  test("other API errors are failures", () => {
    expect(classifyAuthOutcome(new APIError("BAD_REQUEST", { message: "Bad" })).outcome).toBe(
      "failure",
    );
    expect(
      classifyAuthOutcome(new APIError("INTERNAL_SERVER_ERROR", { message: "Boom" })).outcome,
    ).toBe("failure");
  });

  test("carries the reason through, clipped", () => {
    const long = "x".repeat(900);
    const { reason } = classifyAuthOutcome(new APIError("UNAUTHORIZED", { message: long }));
    expect(reason).toBeDefined();
    expect(reason?.length).toBeLessThanOrEqual(500);
  });
});
