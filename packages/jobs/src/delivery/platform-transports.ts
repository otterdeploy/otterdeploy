/**
 * SMS (Twilio) + push (FCM) credentials, resolved from the settings row with
 * the env vars as the seed/fallback. Editable in Settings → Instance, which is
 * what makes them consistent with every other notification destination: Slack,
 * Discord, Telegram, PagerDuty, webhooks and email have always been configured
 * in the UI with their secrets encrypted at rest, while these two alone
 * required an operator to edit `.env` and restart.
 *
 * Lives in @otterdeploy/jobs rather than @otterdeploy/api because both readers
 * are here (./notify.ts for the per-user fan-out, ./channels.ts for the `push`
 * channel kind) and `api` depends on `jobs`, not the reverse: the same
 * constraint that put ./secret-crypto.ts here, whose decrypt this reuses.
 */
import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";

import { decryptSecret } from "./secret-crypto";

/** Undecryptable ciphertext degrades the transport to "not configured": the
 *  caller then logs a no-op and the in-app notification row still lands, which
 *  is strictly better than throwing inside a delivery job. */
async function decryptOrNull(blob: string | null | undefined): Promise<string | null> {
  if (!blob) return null;
  try {
    return await decryptSecret(blob);
  } catch {
    return null;
  }
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

/** FCM server key, or null when push isn't configured from either source. */
export async function fcmServerKey(): Promise<string | null> {
  const row = await settingsRow();
  return (await decryptOrNull(row?.fcmServerKeyCiphertext)) ?? env.FCM_SERVER_KEY ?? null;
}
