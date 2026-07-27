/**
 * Step-up re-authentication — a short-lived "recent auth" grant, checked
 * before the highest-value actions in the product (opening an interactive
 * shell; see ./step-up usage in routers/terminal). Mirrors the existing
 * node-enrollment step-up (routers/server/enrollment-router.ts), which
 * verifies a fresh TOTP code inline on every sensitive call — this module
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
import { Result, TaggedError } from "better-result";

import { createRedis } from "../lib/redis";

/** Grant lifetime — "recent" re-authentication. Long enough that a dropped
 *  WebSocket can reconnect without re-prompting; short enough that a stolen
 *  session (without the password/authenticator) can't ride a stale grant
 *  indefinitely. */
export const STEP_UP_TTL_SECONDS = 5 * 60;

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

/** Revoke any outstanding grant — used when we want to force a fresh
 *  re-auth (e.g. after a failed verification, so a caller can't retry the
 *  RPC and quietly fall back on a still-live grant from earlier). */
export async function clearStepUp(userId: string): Promise<void> {
  await redis().del(grantKey(userId));
}

export class StepUpVerificationError extends TaggedError("StepUpVerificationError")<{
  reason: "two_factor_code_required" | "password_required" | "invalid";
  message: string;
}>() {}

/** Verify a fresh TOTP code against the CURRENT session (no side effects on
 *  the session itself — `trustDevice: false`). Shared by node-enrollment
 *  step-up and terminal step-up so both go through the exact same
 *  authenticator verification, never a hand-rolled parallel check. */
export async function verifyTotpCode(
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
 *  `/verify-password` endpoint (`auth.api.verifyPassword`) — a pure check
 *  against the signed-in user, no new session/cookie side effect at all
 *  (unlike sign-in), which is exactly the "confirm it's still you" primitive
 *  step-up needs. */
export async function verifyPassword(
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
 * Resolve which credential the caller must present — TOTP for accounts with
 * 2FA enabled, password otherwise — and verify it. `input` fields are both
 * optional so the caller can distinguish "you forgot to send anything" from
 * "what you sent was wrong".
 */
export async function verifyStepUpCredential(
  context: { headers: Headers },
  user: { twoFactorEnabled: boolean },
  input: { totpCode?: string; password?: string },
): Promise<Result<void, StepUpVerificationError>> {
  if (user.twoFactorEnabled) {
    if (!input.totpCode) {
      return Result.err(
        new StepUpVerificationError({
          reason: "two_factor_code_required",
          message: "Enter the current authenticator code.",
        }),
      );
    }
    return verifyTotpCode(context, input.totpCode);
  }
  if (!input.password) {
    return Result.err(
      new StepUpVerificationError({ reason: "password_required", message: "Enter your password." }),
    );
  }
  return verifyPassword(context, input.password);
}
