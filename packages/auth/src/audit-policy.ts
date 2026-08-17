/**
 * Policy for the auth audit trail: which better-auth routes are audited, what
 * each one is called, which body fields may be recorded, and how an endpoint
 * result maps to an outcome.
 *
 * Kept free of database and env imports on purpose. This is the part worth
 * unit-testing, and pulling `@otterdeploy/db` in behind it would make the
 * allowlist tests require a configured environment to run. The writer that
 * consumes this lives in ./audit.ts.
 *
 * Three rules hold this file together:
 *
 *  1. **Allowlist, never catch-all.** `/get-session` is hit on every page load
 *     and `/device/token` is polled every few seconds by a waiting CLI.
 *     Auditing "all auth routes" would bury real sign-ins under refresh
 *     traffic: the same mistake the oRPC read gate already made once and
 *     fixed (see `packages/api/src/__tests__/audit-read-gate.test.ts`).
 *  2. **Only identifiers leave the request body.** Passwords, reset tokens,
 *     TOTP codes and backup codes all travel through these endpoints. Fields
 *     are named explicitly per path; there is no path that spreads a body.
 *  3. **Never throw.** Enforced by the caller in ./audit.ts: an audit write
 *     must not be able to fail a sign-in.
 */
import { isJsonObject } from "@otterdeploy/shared/json";
import { isAPIError } from "better-auth/api";

export const MAX_EMAIL = 320;
const MAX_REASON = 500;
export const MAX_ID = 128;

export type Outcome = "success" | "failure" | "denied";

export interface AuditedPath {
  /** `<resource>.<verb>`, matching the convention the oRPC actions use. */
  action: string;
  targetType?: string;
  /**
   * Body fields recorded into the jsonb `target`. Identifiers only: see rule
   * 2. These are request-supplied and unvalidated, so they inform an
   * investigation but never carry authority (and never reach a FK column).
   */
  detailFields?: readonly string[];
  /**
   * Record successes only. For endpoints where failure is the normal resting
   * state: the device-grant token endpoint answers "not yet" to a polling CLI
   * many times per approval, and each of those is noise, not a security event.
   */
  successOnly?: boolean;
}

/**
 * The audited identity surface. Paths are better-auth route paths (verified
 * against the 1.6.11 route table: `/request-password-reset`, for instance, is
 * the real path; `/forget-password` only exists as a rate-limiter alias).
 *
 * Deliberately absent: `/get-session`, `/list-sessions`, `/list-accounts`,
 * `/organization/list*`, `/organization/set-active`, `/api-key/get`,
 * `/api-key/list` and the other reads. A read of your own identity is not an
 * audit event, and the polled ones would dominate the table.
 */
const AUDITED_PATHS: Record<string, AuditedPath> = {
  // ── Authentication ──────────────────────────────────────────────────────
  // Failures here are the point: a burst of them from one address is what the
  // denial-burst rule in notifications/audit-anomaly.ts looks for.
  "/sign-in/email": { action: "auth.signIn", targetType: "user" },
  "/sign-in/social": { action: "auth.signInSocial", detailFields: ["provider"] },
  "/callback": { action: "auth.signInSocialCallback" },
  "/sign-up/email": { action: "auth.signUp", targetType: "user" },
  "/sign-out": { action: "auth.signOut" },

  // ── Credentials ─────────────────────────────────────────────────────────
  "/request-password-reset": { action: "auth.passwordResetRequest" },
  "/reset-password": { action: "auth.passwordReset" },
  "/change-password": { action: "auth.passwordChange" },
  "/change-email": { action: "auth.emailChange" },
  "/verify-email": { action: "auth.emailVerify" },
  "/delete-user": { action: "auth.userDelete", targetType: "user" },

  // ── Sessions ────────────────────────────────────────────────────────────
  // The session token itself is never recorded. Revoking by token would put a
  // live credential in a 90-day table.
  "/revoke-session": { action: "auth.sessionRevoke" },
  "/revoke-sessions": { action: "auth.sessionRevokeAll" },
  "/revoke-other-sessions": { action: "auth.sessionRevokeOthers" },

  // ── Two-factor ──────────────────────────────────────────────────────────
  // Verify failures are kept: repeated ones are a 2FA brute-force attempt.
  "/two-factor/enable": { action: "auth.twoFactorEnable" },
  "/two-factor/disable": { action: "auth.twoFactorDisable" },
  "/two-factor/verify-totp": { action: "auth.twoFactorVerify" },
  "/two-factor/verify-otp": { action: "auth.twoFactorVerify" },
  "/two-factor/verify-backup-code": { action: "auth.twoFactorBackupVerify" },
  "/two-factor/generate-backup-codes": { action: "auth.twoFactorBackupRegenerate" },

  // ── Passkeys ────────────────────────────────────────────────────────────
  // Registering a passkey adds a durable sign-in credential to the account and
  // deleting one removes it, so both are audited. Verify failures are kept:
  // repeated ones are someone probing a stolen credential. The generate-*
  // option endpoints are omitted — like `/device/code`, requesting a challenge
  // proves nothing until it is verified.
  "/passkey/verify-registration": { action: "auth.passkeyRegister" },
  "/passkey/delete-passkey": { action: "auth.passkeyDelete" },
  "/passkey/verify-authentication": { action: "auth.passkeyVerify" },

  // ── CLI device grant ────────────────────────────────────────────────────
  // Approving a device code hands a CLI a bearer token for the whole account,
  // so approve/deny are audited. `/device/token` is success-only (see
  // `successOnly`) and `/device/code` is omitted: requesting a code proves
  // nothing until someone approves it.
  "/device/approve": { action: "auth.deviceApprove" },
  "/device/deny": { action: "auth.deviceDeny" },
  "/device/token": { action: "auth.deviceTokenIssue", successOnly: true },

  // ── API keys ────────────────────────────────────────────────────────────
  // The web app drives these through `authClient.apiKey.*` (the plugin owns
  // them; see apps/web/src/features/api-keys/data/api-keys.ts), so they never
  // pass through the oRPC audit path.
  "/api-key/create": { action: "apiKey.create", targetType: "apiKey" },
  "/api-key/update": { action: "apiKey.update", targetType: "apiKey", detailFields: ["keyId"] },
  "/api-key/delete": { action: "apiKey.delete", targetType: "apiKey", detailFields: ["keyId"] },

  // ── Membership ──────────────────────────────────────────────────────────
  // Same story: `authClient.organization.*` from the web app. "Who let this
  // person in, and who made them an owner" is the question these answer.
  "/organization/create": { action: "organization.create", targetType: "organization" },
  "/organization/update": { action: "organization.update", targetType: "organization" },
  "/organization/delete": { action: "organization.delete", targetType: "organization" },
  "/organization/invite-member": {
    action: "organization.inviteMember",
    targetType: "invitation",
    detailFields: ["email", "role"],
  },
  "/organization/cancel-invitation": {
    action: "organization.cancelInvitation",
    targetType: "invitation",
    detailFields: ["invitationId"],
  },
  "/organization/accept-invitation": {
    action: "organization.acceptInvitation",
    targetType: "invitation",
    detailFields: ["invitationId"],
  },
  "/organization/reject-invitation": {
    action: "organization.rejectInvitation",
    targetType: "invitation",
    detailFields: ["invitationId"],
  },
  "/organization/remove-member": {
    action: "organization.removeMember",
    targetType: "member",
    detailFields: ["memberIdOrEmail"],
  },
  "/organization/update-member-role": {
    action: "organization.updateMemberRole",
    targetType: "member",
    detailFields: ["memberId", "role"],
  },
  "/organization/leave": { action: "organization.leave", targetType: "organization" },
  "/organization/create-role": {
    action: "organization.createRole",
    targetType: "role",
    detailFields: ["role"],
  },
  "/organization/update-role": {
    action: "organization.updateRole",
    targetType: "role",
    detailFields: ["roleName"],
  },
  "/organization/delete-role": {
    action: "organization.deleteRole",
    targetType: "role",
    detailFields: ["roleName"],
  },
};

/**
 * Resolve a route path to its audit entry.
 *
 * Social sign-in completes at `/callback/:id`, whose concrete path carries the
 * provider id. Matching that prefix keeps the completion of an OAuth sign-in
 * audited without one entry per configured provider.
 */
export function auditEntryForPath(path: string): AuditedPath | null {
  const exact = AUDITED_PATHS[path];
  if (exact) return exact;
  if (path.startsWith("/callback/")) return AUDITED_PATHS["/callback"] ?? null;
  return null;
}

/**
 * Map an endpoint result to an audit outcome.
 *
 * 401/403 become `denied` rather than `failure` so they read as a refused
 * action in the same state vocabulary the oRPC middleware uses (see
 * `DENIED_ORPC_CODES` in authz/procedure-audit.ts), and so a wrong password,
 * which is a refusal rather than a malfunction, lands in the bucket an auditor
 * expects. Both are counted by the denial-burst anomaly rule.
 */
export function classifyAuthOutcome(returned: unknown): { outcome: Outcome; reason?: string } {
  if (!isAPIError(returned)) return { outcome: "success" };
  const status = returned.statusCode;
  const outcome: Outcome = status === 401 || status === 403 ? "denied" : "failure";
  const reason = returned.body?.message ?? returned.body?.code;
  return { outcome, reason: reason ? reason.slice(0, MAX_REASON) : undefined };
}

export function clip(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

/** Pull the allowlisted identifier fields out of a request body. */
export function detailFrom(
  body: unknown,
  fields: readonly string[] | undefined,
): Record<string, string> {
  if (!fields || !isJsonObject(body)) return {};
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = clip(body[field], MAX_ID);
    if (value) out[field] = value;
  }
  return out;
}
