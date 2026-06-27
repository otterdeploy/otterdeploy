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
 * Missing provider config or destination is a logged no-op, not an error —
 * the job still succeeds on the strength of the persisted in-app row.
 */
import { env } from "@otterdeploy/env/server";

import type { JobLogger } from "../define";

interface DeliverInput {
  channel: "push" | "sms";
  userId: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  log: JobLogger;
}

/** Returns true only when an external provider actually accepted the message. */
export async function deliverExternal(input: DeliverInput): Promise<boolean> {
  if (input.channel === "sms") return deliverSms(input);
  return deliverPush(input);
}

async function deliverSms(input: DeliverInput): Promise<boolean> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;
  const to = typeof input.data?.phone === "string" ? input.data.phone : null;

  if (!sid || !token || !from) {
    input.log.warn({ notification: { channel: "sms", skipped: "no_provider" } });
    return false;
  }
  if (!to) {
    input.log.warn({ notification: { channel: "sms", skipped: "no_destination" } });
    return false;
  }

  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: `${input.title}\n${input.message}`,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    input.log.error({
      notification: { channel: "sms", status: res.status, error: await res.text() },
    });
    throw new Error(`Twilio send failed: ${res.status}`);
  }
  input.log.info({ notification: { channel: "sms", delivered: true } });
  return true;
}

async function deliverPush(input: DeliverInput): Promise<boolean> {
  const key = env.FCM_SERVER_KEY;
  const deviceToken = typeof input.data?.deviceToken === "string" ? input.data.deviceToken : null;

  if (!key) {
    input.log.warn({ notification: { channel: "push", skipped: "no_provider" } });
    return false;
  }
  if (!deviceToken) {
    input.log.warn({ notification: { channel: "push", skipped: "no_destination" } });
    return false;
  }

  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      Authorization: `key=${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: deviceToken,
      notification: { title: input.title, body: input.message },
      data: input.data ?? {},
    }),
  });
  if (!res.ok) {
    input.log.error({
      notification: { channel: "push", status: res.status, error: await res.text() },
    });
    throw new Error(`FCM send failed: ${res.status}`);
  }
  input.log.info({ notification: { channel: "push", delivered: true } });
  return true;
}
