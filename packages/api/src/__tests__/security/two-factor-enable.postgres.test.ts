/**
 * Turning on two-factor auth works against the migrated schema.
 *
 * Drives the REAL configured auth instance (`@otterdeploy/auth`) as a signed-in
 * user. better-auth's `twoFactor` plugin writes `failedVerificationCount` and
 * `lockedUntil` on its `two_factor` row: without those columns in the Drizzle
 * schema, enabling failed with "The field ... does not exist in the
 * \"twoFactor\" Drizzle schema". A wrong code counts toward the account's
 * failure budget instead of being forgotten.
 */
import { auth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { twoFactor } from "@otterdeploy/db/schema/auth";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { ORIGIN, PASSWORD, openRegistration, signIn, signUp } from "../postgres-actors";

let restoreRegistration: () => Promise<void>;

beforeAll(async () => {
  restoreRegistration = await openRegistration();
});

afterAll(async () => {
  await restoreRegistration?.();
});

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The authenticator-app side of the enrolment: the URI carries the shared
 *  secret base32-encoded, and the plugin keys its codes on the original text. */
function secretFromUri(totpURI: string): string {
  const encoded = new URL(totpURI).searchParams.get("secret");
  if (!encoded) throw new Error("the TOTP URI carries no secret");
  let bits = "";
  for (const char of encoded.replace(/=+$/, "")) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes = Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
    Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2),
  );
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

async function twoFactorRow(userId: string) {
  const [row] = await db
    .select({
      failedVerificationCount: twoFactor.failedVerificationCount,
      lockedUntil: twoFactor.lockedUntil,
    })
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId));
  return row;
}

describe("enabling two-factor auth", () => {
  it("creates the two_factor row with a zero failure count", async () => {
    const owner = await signUp("two-factor-enable");
    const headers = await signIn(owner.email);

    const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });

    expect(enabled.totpURI).toContain("otpauth://totp/");
    expect(enabled.backupCodes.length).toBeGreaterThan(0);
    expect(await twoFactorRow(owner.id)).toEqual({
      failedVerificationCount: 0,
      lockedUntil: null,
    });
  });

  it("counts a wrong sign-in code against the account", async () => {
    const owner = await signUp("two-factor-wrong-code");
    const headers = await signIn(owner.email);
    const { totpURI } = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
    const secret = secretFromUri(totpURI);

    // Confirm the authenticator with a right code, so 2FA is on for sign-in.
    const { code } = await auth.api.generateTOTP({ body: { secret } });
    await auth.api.verifyTOTP({ body: { code }, headers });
    expect(await twoFactorRow(owner.id)).toEqual({ failedVerificationCount: 0, lockedUntil: null });

    // A password sign-in now stops at the second factor.
    const challenge = await auth.api.signInEmail({
      body: { email: owner.email, password: PASSWORD },
      returnHeaders: true,
    });
    expect(challenge.response).toMatchObject({ twoFactorRedirect: true });
    const challengeHeaders = new Headers({
      cookie: challenge.headers
        .getSetCookie()
        .map((line) => line.split(";")[0])
        .join("; "),
      origin: ORIGIN,
    });

    for (const expected of [1, 2]) {
      const wrong = await Result.tryPromise(() =>
        auth.api.verifyTOTP({ body: { code: "000000" }, headers: challengeHeaders }),
      );
      expect(wrong.isErr()).toBe(true);
      expect((await twoFactorRow(owner.id))?.failedVerificationCount).toBe(expected);
    }
  });
});
