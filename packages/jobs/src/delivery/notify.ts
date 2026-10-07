/**
 * External notification delivery (push / sms). The in-app row is always
 * written by the job; this module fans out to a real provider when one is
 * configured AND the payload carries a destination.
 *
 * Destinations ride on the notification's `data` payload because the user
 * table doesn't (yet) store phone numbers or device tokens:
 *   - sms  → `data.phone` (E.164, e.g. "+14155550123")
 *   - push → `data.deviceToken` (FCM registration token)
 *
 * Provider credentials come from ./platform-transports (Twilio from the
 * settings row, seeded from TWILIO_*; push from FCM_SERVICE_ACCOUNT_JSON).
 * Missing provider config or destination is a logged no-op, not an error: the
 * job still succeeds on the strength of the persisted in-app row. Both
 * requests go through the guarded ./post.ts path, so they share its timeout,
 * egress policy and bounded 429/5xx retry.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { Result } from "better-result";
import * as z from "zod";

import type { JobLogger } from "../define";

import { sendFcm } from "./fcm";
import { TEXT_LIMIT, truncatedText } from "./message";
import { FCM_LEGACY_KEY_ERROR, fcmCredentials, twilioConfig } from "./platform-transports";
import { httpFailure, RETRYABLE_STATUSES, request } from "./post";

interface DeliverInput {
  channel: "push" | "sms";
  userId: string;
  title: string;
  message: string;
  data?: JsonObject;
  log: JobLogger;
}

/** What happened to the external half of one notification. */
export type ExternalDelivery =
  | { status: "delivered" }
  | { status: "skipped"; reason: "no_provider" | "no_destination" }
  | { status: "failed"; error: string; retryable: boolean };

/** Destination keys: where the message goes, never part of what it says. */
const DESTINATION_KEYS = new Set(["deviceToken", "phone"]);

export async function deliverExternal(input: DeliverInput): Promise<ExternalDelivery> {
  const outcome = input.channel === "sms" ? await deliverSms(input) : await deliverPush(input);
  if (outcome.status === "delivered") {
    input.log.info({ notification: { channel: input.channel, delivered: true } });
  } else if (outcome.status === "skipped") {
    input.log.warn({ notification: { channel: input.channel, skipped: outcome.reason } });
  } else {
    input.log.error({
      notification: { channel: input.channel, error: outcome.error, retryable: outcome.retryable },
    });
  }
  return outcome;
}

const twilioErrorSchema = z.object({ code: z.number(), message: z.string() });

async function deliverSms(input: DeliverInput): Promise<ExternalDelivery> {
  const twilio = await twilioConfig();
  const to = typeof input.data?.phone === "string" ? input.data.phone : null;
  if (!twilio) return { status: "skipped", reason: "no_provider" };
  if (!to) return { status: "skipped", reason: "no_destination" };

  // Twilio rejects a Body over 1600 characters (error 21617) instead of
  // splitting it, so the message is shortened here rather than lost there.
  const body = new URLSearchParams({
    To: to,
    From: twilio.fromNumber,
    Body: truncatedText(`${input.title}\n${input.message}`, TEXT_LIMIT.twilioBody),
  });
  const answered = await request(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilio.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${twilio.accountSid}:${twilio.authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
    { followRedirects: false },
  );
  if (answered.isErr()) {
    return { status: "failed", error: answered.error.message, retryable: answered.error.retryable };
  }
  const response = answered.value;
  if (response.ok) return { status: "delivered" };
  const detail = Result.try(() => twilioErrorSchema.parse(JSON.parse(response.text)));
  return {
    status: "failed",
    error: detail.isOk()
      ? `Twilio ${detail.value.code} (${response.status}): ${detail.value.message}`
      : `Twilio send failed: ${httpFailure(response)}`,
    retryable: RETRYABLE_STATUSES.has(response.status),
  };
}

async function deliverPush(input: DeliverInput): Promise<ExternalDelivery> {
  const deviceToken = typeof input.data?.deviceToken === "string" ? input.data.deviceToken : null;
  const credentials = await fcmCredentials();
  if (credentials.kind === "none") return { status: "skipped", reason: "no_provider" };
  if (!deviceToken) return { status: "skipped", reason: "no_destination" };
  if (credentials.kind === "legacy-key") {
    return { status: "failed", error: FCM_LEGACY_KEY_ERROR, retryable: false };
  }
  if (credentials.kind === "invalid") {
    return { status: "failed", error: credentials.error, retryable: false };
  }

  const data = Object.fromEntries(
    Object.entries(input.data ?? {}).filter(([key]) => !DESTINATION_KEYS.has(key)),
  );
  const sent = await sendFcm(credentials.account, {
    target: deviceToken,
    title: input.title,
    body: input.message,
    data,
  });
  return sent.ok
    ? { status: "delivered" }
    : {
        status: "failed",
        error: sent.error ?? "FCM send failed",
        retryable: sent.retryable ?? false,
      };
}
