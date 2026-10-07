/**
 * SMS (Twilio) + push (FCM) credentials. Twilio resolves from the settings row
 * with the env vars as the seed/fallback; push from FCM_SERVICE_ACCOUNT_JSON
 * (see {@link fcmCredentials}).
 *
 * Lives in @otterdeploy/jobs rather than @otterdeploy/api because both readers
 * are here (./notify.ts for the per-user fan-out, ./channels.ts for the `push`
 * channel kind) and `api` depends on `jobs`, not the reverse: the same
 * constraint that put ./secret-crypto.ts here, whose decrypt this reuses.
 */
import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { type FcmServiceAccount, parseFcmServiceAccount } from "./fcm";
import { decryptSecret } from "./secret-crypto";

/** Undecryptable ciphertext degrades the transport to "not configured": the
 *  caller then logs a no-op and the in-app notification row still lands, which
 *  is strictly better than throwing inside a delivery job. */
async function decryptOrNull(blob: string | null | undefined): Promise<string | null> {
  if (!blob) return null;
  const decrypted = await Result.tryPromise({
    try: () => decryptSecret(blob),
    catch: (cause) => cause,
  });
  return decrypted.unwrapOr(null);
}

async function settingsRow() {
  const [row] = await db
    .select({
      twilioAccountSid: platformSettings.twilioAccountSid,
      twilioAuthTokenCiphertext: platformSettings.twilioAuthTokenCiphertext,
      twilioFromNumber: platformSettings.twilioFromNumber,
      fcmServerKeyCiphertext: platformSettings.fcmServerKeyCiphertext,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row;
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

/** Null unless all three parts resolve. A half-configured Twilio is treated
 *  as unconfigured rather than producing a guaranteed 401 on every send. */
export async function twilioConfig(): Promise<TwilioConfig | null> {
  const row = await settingsRow();
  const accountSid = row?.twilioAccountSid ?? env.TWILIO_ACCOUNT_SID ?? null;
  const fromNumber = row?.twilioFromNumber ?? env.TWILIO_FROM_NUMBER ?? null;
  const authToken =
    (await decryptOrNull(row?.twilioAuthTokenCiphertext)) ?? env.TWILIO_AUTH_TOKEN ?? null;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

/** How push is configured, and why it cannot send when it cannot. */
export type FcmCredentials =
  | { kind: "service-account"; account: FcmServiceAccount }
  | { kind: "invalid"; error: string }
  | { kind: "legacy-key" }
  | { kind: "none" };

/** What a push configured only with a legacy server key reports. */
export const FCM_LEGACY_KEY_ERROR =
  "FCM is configured with a legacy server key (FCM_SERVER_KEY), and Google shut the legacy " +
  "FCM API down in 2024. Set FCM_SERVICE_ACCOUNT_JSON to the Firebase service-account key " +
  "file (Project settings → Service accounts → Generate new private key).";

/**
 * Push credentials. The service-account key file (FCM_SERVICE_ACCOUNT_JSON)
 * is the only thing that can send. A legacy server key, from FCM_SERVER_KEY or
 * the old settings column, is recognised only to say it no longer works: it
 * used to be sent to the shut-down legacy API and every push failed with a
 * redirect the delivery log blamed on the egress policy.
 */
export async function fcmCredentials(): Promise<FcmCredentials> {
  const json = env.FCM_SERVICE_ACCOUNT_JSON;
  if (json) {
    const parsed = parseFcmServiceAccount(json);
    return parsed.isOk()
      ? { kind: "service-account", account: parsed.value }
      : { kind: "invalid", error: parsed.error };
  }
  const row = await settingsRow();
  const legacy = (await decryptOrNull(row?.fcmServerKeyCiphertext)) ?? env.FCM_SERVER_KEY;
  return legacy ? { kind: "legacy-key" } : { kind: "none" };
}
