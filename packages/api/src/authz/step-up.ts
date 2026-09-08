/**
 * Step-up re-authentication: a short-lived "recent auth" grant, checked
 * before the highest-value actions in the product (opening an interactive
 * shell; see ./step-up usage in routers/terminal). Mirrors the existing
 * node-enrollment step-up (routers/server/enrollment-router.ts), which
 * verifies a fresh TOTP code inline on every sensitive call. This module
 * extracts that verification into a shared primitive and adds a short Redis
 * grant so a user who just stepped up doesn't have to re-enter a code/password
 * on every reconnect within the window (od-5j8.9).
 *
 * Verification never mutates the caller's session: `verifyTOTP` runs with
 * `trustDevice: false`, and the password path calls better-auth's dedicated
 * `verifyPassword` endpoint, which checks the CURRENT session's password with
 * no session/cookie side effect at all. A confirmed grant is a capability,
 * not a session change.
 */

import type { RedisClient } from "bun";

import { auth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { account } from "@otterdeploy/db/schema";
import { Result, TaggedError } from "better-result";
import { and, eq, isNotNull } from "drizzle-orm";

import { createRedis } from "../lib/redis";

/** Grant lifetime: "recent" re-authentication. Long enough that a dropped
 *  WebSocket can reconnect without re-prompting; short enough that a stolen
 *  session (without the password/authenticator) can't ride a stale grant
 *  indefinitely. */
const STEP_UP_TTL_SECONDS = 5 * 60;

let client: RedisClient | null = null;
function redis(): RedisClient {
  if (!client) client = createRedis();
  return client;
}

const grantKey = (userId: string) => `stepup:grant:${userId}`;

/** Record a fresh re-authentication for `userId`. Returns the grant's expiry. */
export async function grantStepUp(userId: string): Promise<Date> {
  await redis().set(grantKey(userId), "1", "EX", String(STEP_UP_TTL_SECONDS));
  return new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000);
}

/** Whether `userId` re-authenticated within the last `STEP_UP_TTL_SECONDS`. */
export async function hasRecentStepUp(userId: string): Promise<boolean> {
  return (await redis().get(grantKey(userId))) !== null;
}

/** Revoke any outstanding grant, used when we want to force a fresh
 *  re-auth (e.g. after a failed verification, so a caller can't retry the
 *  RPC and quietly fall back on a still-live grant from earlier). */
export async function clearStepUp(userId: string): Promise<void> {
  await redis().del(grantKey(userId));
}

class StepUpVerificationError extends TaggedError("StepUpVerificationError")<{
  reason: "two_factor_code_required" | "password_required" | "no_credential" | "invalid";
  message: string;
}>() {}

/**
 * Does this account have a password to verify?
 *
 * `verifyStepUpCredential` used to assume every non-2FA user did, which is
 * false for a whole class of accounts this install creates on purpose: an
 * invited user who never set one, a passkey-only sign-in (the `passkey` plugin
 * is enabled), and any social/SSO account. Those users were asked for a
 * password that does not exist, could never satisfy it, and were locked out of
 * every step-up-gated action permanently — with the prompt simply reappearing
 * (od-rvca).
 *
 * better-auth stores a password account as `account.providerId = "credential"`
 * with a non-null `password`. A row with a null password is a placeholder, not
 * a usable credential, so it is excluded.
 */
async function hasPasswordCredential(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, "credential"),
        isNotNull(account.password),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Verify a fresh TOTP code against the CURRENT session (no side effects on
 *  the session itself: `trustDevice: false`). Shared by node-enrollment
 *  step-up and terminal step-up so both go through the exact same
 *  authenticator verification, never a hand-rolled parallel check. */
async function verifyTotpCode(
  context: { headers: Headers },
  code: string,
): Promise<Result<void, StepUpVerificationError>> {
  const verified = await Result.tryPromise({
    try: () =>
      auth.api.verifyTOTP({ headers: context.headers, body: { code, trustDevice: false } }),
    catch: (cause) => cause,
  });
  if (verified.isErr()) {
    return Result.err(
      new StepUpVerificationError({
        reason: "invalid",
        message: "The authenticator code is invalid.",
      }),
    );
  }
  return Result.ok(undefined);
}

/** Verify the CURRENT session's password via better-auth's dedicated
 *  `/verify-password` endpoint (`auth.api.verifyPassword`): a pure check
 *  against the signed-in user, no new session/cookie side effect at all
 *  (unlike sign-in), which is exactly the "confirm it's still you" primitive
 *  step-up needs. */
async function verifyPassword(
  context: { headers: Headers },
  password: string,
): Promise<Result<void, StepUpVerificationError>> {
  const verified = await Result.tryPromise({
    try: () => auth.api.verifyPassword({ headers: context.headers, body: { password } }),
    catch: (cause) => cause,
  });
  if (verified.isErr()) {
    return Result.err(
      new StepUpVerificationError({ reason: "invalid", message: "The password is incorrect." }),
    );
  }
  return Result.ok(undefined);
}

/**
 * Resolve which credential the caller must present: TOTP for accounts with
 * 2FA enabled, password otherwise, and verify it. `input` fields are both
 * optional so the caller can distinguish "you forgot to send anything" from
 * "what you sent was wrong".
 */
export type StepUpMethod =
  | { kind: "totp"; code: string }
  | { kind: "password"; password: string }
  | {
      kind: "unusable";
      reason: "two_factor_code_required" | "password_required" | "no_credential";
    };

/**
 * WHICH credential this account must present, and whether it supplied it.
 *
 * Pure and separated from the verifying so the matrix is testable without a
 * database or an auth server — and the matrix is where the bug was. The old
 * code had two branches, TOTP or password, with no third, so it asked a
 * passwordless account for a password: unanswerable, and re-prompted forever
 * because nothing the user could type would ever verify (od-rvca).
 *
 * `hasPassword` is resolved by the caller rather than looked up here, both to
 * keep this pure and because "does this account have a credential" is a fact
 * about the account, not a decision.
 */
export function chooseStepUpMethod(
  user: { twoFactorEnabled: boolean },
  hasPassword: boolean,
  input: { totpCode?: string; password?: string },
): StepUpMethod {
  if (user.twoFactorEnabled) {
    return input.totpCode
      ? { kind: "totp", code: input.totpCode }
      : { kind: "unusable", reason: "two_factor_code_required" };
  }
  // Checked BEFORE asking: an account with nothing to present must be told
  // that, not handed a prompt it cannot satisfy.
  if (!hasPassword) return { kind: "unusable", reason: "no_credential" };
  return input.password
    ? { kind: "password", password: input.password }
    : { kind: "unusable", reason: "password_required" };
}

const UNUSABLE_MESSAGE: Record<Extract<StepUpMethod, { kind: "unusable" }>["reason"], string> = {
  two_factor_code_required: "Enter the current authenticator code.",
  password_required: "Enter your password.",
  no_credential:
    "This action needs you to confirm it is you, but your account has no password or " +
    "authenticator to confirm with. Add one in Settings → Account (set a password, or enable " +
    "two-factor authentication), then try again.",
};

export async function verifyStepUpCredential(
  context: { headers: Headers },
  user: { id: string; twoFactorEnabled: boolean },
  input: { totpCode?: string; password?: string },
): Promise<Result<void, StepUpVerificationError>> {
  // Only queried on the non-2FA path: an account with an authenticator never
  // needs the answer, and this runs on every shell reconnect.
  const hasPassword = user.twoFactorEnabled ? true : await hasPasswordCredential(user.id);
  const method = chooseStepUpMethod(user, hasPassword, input);

  switch (method.kind) {
    case "totp":
      return verifyTotpCode(context, method.code);
    case "password":
      return verifyPassword(context, method.password);
    case "unusable":
      return Result.err(
        new StepUpVerificationError({
          reason: method.reason,
          message: UNUSABLE_MESSAGE[method.reason],
        }),
      );
  }
}
