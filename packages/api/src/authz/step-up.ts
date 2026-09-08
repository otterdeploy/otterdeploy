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
import { AccessCodeEmail, sendEmail } from "@otterdeploy/email";
import { Result, TaggedError } from "better-result";
import { and, eq, isNotNull } from "drizzle-orm";

import { createRedis } from "../lib/redis";
import { consumeOtp, generateOtp, storeOtp, underRateLimit } from "./otp";

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
  reason:
    | "two_factor_code_required"
    | "password_required"
    | "email_code_required"
    | "no_credential"
    | "invalid";
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
  | { kind: "email_otp"; code: string }
  | {
      kind: "unusable";
      reason:
        | "two_factor_code_required"
        | "password_required"
        | "email_code_required"
        | "no_credential";
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
  input: { totpCode?: string; password?: string; emailCode?: string },
): StepUpMethod {
  if (user.twoFactorEnabled) {
    return input.totpCode
      ? { kind: "totp", code: input.totpCode }
      : { kind: "unusable", reason: "two_factor_code_required" };
  }
  // No password and no authenticator does NOT mean nothing to prove with. The
  // account still controls the mailbox it was invited to, and for a
  // passwordless account that mailbox IS its credential — it is the only thing
  // that could reset or re-establish access anyway. Telling such a user to go
  // add a password first is asking them to weaken their account for our
  // convenience, and it blocks the feature entirely until they do (od-rvca
  // stopped the lockout; this removes the errand).
  if (!hasPassword) {
    return input.emailCode
      ? { kind: "email_otp", code: input.emailCode }
      : { kind: "unusable", reason: "email_code_required" };
  }
  return input.password
    ? { kind: "password", password: input.password }
    : { kind: "unusable", reason: "password_required" };
}

const UNUSABLE_MESSAGE: Record<Extract<StepUpMethod, { kind: "unusable" }>["reason"], string> = {
  two_factor_code_required: "Enter the current authenticator code.",
  password_required: "Enter your password.",
  email_code_required: "Enter the code we emailed you.",
  no_credential:
    "This action needs you to confirm it is you, but your account has no password or " +
    "authenticator to confirm with, and no email address to send a code to. Add one in " +
    "Settings → Account, then try again.",
};

export async function verifyStepUpCredential(
  context: { headers: Headers },
  user: { id: string; email?: string | null; twoFactorEnabled: boolean },
  input: { totpCode?: string; password?: string; emailCode?: string },
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
    case "email_otp":
      return verifyEmailCode(user.email, method.code);
    case "unusable":
      return Result.err(
        new StepUpVerificationError({
          reason: method.reason,
          message: UNUSABLE_MESSAGE[method.reason],
        }),
      );
  }
}

/**
 * Step-up by emailed one-time code, for an account with no password and no
 * authenticator.
 *
 * Built on ./otp.ts rather than a second implementation of the same thing:
 * that module already does crypto-random 6 digits, a Redis TTL, single use, a
 * per-request rate limit and a wrong-guess cap that BURNS the code when
 * exhausted — the last of which is what keeps a 10^6 space from being
 * brute-forced inside the 10-minute window. Its key is (domain, email); the
 * synthetic domain below scopes step-up codes away from the guest-access ones
 * so neither can redeem the other's.
 */
const STEP_UP_OTP_SCOPE = "step-up";

async function verifyEmailCode(
  email: string | null | undefined,
  code: string,
): Promise<Result<void, StepUpVerificationError>> {
  if (!email) {
    return Result.err(
      new StepUpVerificationError({
        reason: "no_credential",
        message: UNUSABLE_MESSAGE.no_credential,
      }),
    );
  }
  const ok = await consumeOtp(STEP_UP_OTP_SCOPE, email, code);
  return ok
    ? Result.ok(undefined)
    : Result.err(
        new StepUpVerificationError({
          reason: "invalid",
          message: "That code is incorrect or has expired.",
        }),
      );
}

/** Whether this account steps up by emailed code: no authenticator, no
 *  password. Exported so the send endpoint can refuse to email a code to an
 *  account that should be using a stronger factor it already has. */
export async function usesEmailStepUp(user: {
  id: string;
  twoFactorEnabled: boolean;
}): Promise<boolean> {
  if (user.twoFactorEnabled) return false;
  return !(await hasPasswordCredential(user.id));
}

export class StepUpCodeSendError extends TaggedError("StepUpCodeSendError")<{
  reason: "not_applicable" | "rate_limited" | "no_email" | "send_failed";
  message: string;
}>() {}

/**
 * Email a step-up code, and say plainly when we will not.
 *
 * Refuses for an account that HAS a stronger factor: emailing a code to
 * someone with an authenticator would quietly offer a weaker path to the same
 * gate, which is the opposite of stepping up.
 */
export async function sendStepUpEmailCode(user: {
  id: string;
  email?: string | null;
  name?: string | null;
  twoFactorEnabled: boolean;
}): Promise<Result<{ sentTo: string }, StepUpCodeSendError>> {
  if (!(await usesEmailStepUp(user))) {
    return Result.err(
      new StepUpCodeSendError({
        reason: "not_applicable",
        message: "This account confirms with its authenticator or password, not an emailed code.",
      }),
    );
  }
  if (!user.email) {
    return Result.err(
      new StepUpCodeSendError({ reason: "no_email", message: UNUSABLE_MESSAGE.no_credential }),
    );
  }
  if (!(await underRateLimit(STEP_UP_OTP_SCOPE, user.email))) {
    return Result.err(
      new StepUpCodeSendError({
        reason: "rate_limited",
        message: "Too many codes requested. Wait a few minutes and try again.",
      }),
    );
  }

  const code = generateOtp();
  await storeOtp(STEP_UP_OTP_SCOPE, user.email, code);

  const sent = await Result.tryPromise({
    try: () =>
      sendEmail({
        to: user.email ?? "",
        subject: `Your otterdeploy confirmation code: ${code}`,
        text:
          `Your one-time code to confirm a sensitive action is: ${code}\n\n` +
          `It expires in 10 minutes and can be used once. If you did not request it, ignore ` +
          `this email and no action will be taken.`,
        react: AccessCodeEmail({ domain: "otterdeploy", code, expiresInMinutes: 10 }),
      }),
    catch: (cause) => cause,
  });
  if (sent.isErr()) {
    return Result.err(
      new StepUpCodeSendError({
        reason: "send_failed",
        message:
          "Could not send the code. The install has no working email transport: configure one " +
          "in Settings → Email, or add a password/authenticator to this account instead.",
      }),
    );
  }
  return Result.ok({ sentTo: maskEmail(user.email) });
}

/** `p***@example.com`. Enough for the operator to recognise the mailbox,
 *  without printing it in full to a shared terminal. */
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, 1);
  return domain ? `${head}***@${domain}` : `${head}***`;
}
