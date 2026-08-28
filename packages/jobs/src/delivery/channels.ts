import { NotificationEmail, sendEmail, sendViaSmtpServer } from "@otterdeploy/email";

/**
 * Notification-channel transports. Given a resolved channel (secret already
 * decrypted) and a platform event, push the message to the destination. Pure
 * delivery: the caller (notification.event job) owns DB reads, the delivery
 * log, and retry. Each transport returns a {@link DeliveryResult}; it never
 * throws for an expected provider error (bad webhook, 4xx) so one dead channel
 * can't fail the whole fan-out.
 *
 *   slack/discord, incoming-webhook POST (provider-shaped JSON body)
 *   webhook: generic POST + optional HMAC-SHA256 signature header
 *   email: Resend (packages/email)
 *   telegram: Bot API sendMessage (bot token = secret, chat id = target)
 *   pagerduty: Events API v2 enqueue (routing key = secret || target)
 *
 * `channel.target` is tenant-supplied for slack/discord/webhook (a URL the
 * org pasted in): every transport POSTs through `post()`, which routes
 * through the shared egress policy: resolves and validates every address
 * (loopback/private/link-local/metadata ranges and the control plane's own
 * identity denied by default), pins the connection to the validated
 * address, and re-validates every redirect hop. See
 * packages/shared/src/egress-policy.ts. Fixed-URL transports (FCM,
 * PagerDuty) go through the same helper for consistency. Harmless, since
 * they always resolve to a public address.
 */
import type { ChannelEvent, DeliveryResult, ResolvedChannel } from "./types";

import { deliverDiscord, deliverSlack, deliverTelegram } from "./chat-transports";
import { SEVERITY, dedupKey, nowIso, subjectOf, titleOf } from "./message";
import { fcmServerKey } from "./platform-transports";
import { post } from "./post";

export async function deliverToChannel(
  channel: ResolvedChannel,
  event: ChannelEvent,
): Promise<DeliveryResult> {
  switch (channel.kind) {
    case "slack":
      return deliverSlack(channel, event);
    case "discord":
      return deliverDiscord(channel, event);
    case "webhook":
      return deliverWebhook(channel, event);
    case "email":
      return deliverEmail(channel, event);
    case "telegram":
      return deliverTelegram(channel, event);
    case "pagerduty":
      return deliverPagerduty(channel, event);
    case "push":
      return deliverPush(channel, event);
  }
}

async function deliverWebhook(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const subject = subjectOf(e.data);
  const body = JSON.stringify({
    event: e.eventId,
    severity: e.severity,
    severityLabel: SEVERITY[e.severity].word,
    title: e.title,
    message: e.message,
    // The resource the event is about, lifted out of `data` so a consumer can
    // route on it without knowing which key this event family happens to use.
    subject,
    data: e.data ?? {},
    channel: c.name,
    occurredAt: nowIso(),
  });
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Optional HMAC-SHA256 over the raw body so receivers can verify origin.
  if (c.secret) {
    headers["x-otterdeploy-signature"] = `sha256=${await hmacSha256Hex(c.secret, body)}`;
  }
  return post(c.target, { method: "POST", headers, body });
}

async function deliverEmail(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const from = typeof c.config.from === "string" ? c.config.from : undefined;
  const subject = `[otterdeploy] ${e.title}`;
  // Every channel email is the same React Email component, never a raw HTML
  // string. The SMTP branch renders it here (it uses the channel's own server,
  // so it can't go through sendEmail); the Resend branch hands the element off.
  const notification = NotificationEmail({
    title: e.title,
    message: e.message,
    severity: e.severity,
    data: e.data,
  });
  // `client` picks the transport: "smtp" uses the channel's own SMTP server
  // (config host/port/user + secret password); anything else uses Resend.
  const client = c.config.client === "smtp" ? "smtp" : "resend";

  try {
    if (client === "smtp") {
      const host = typeof c.config.host === "string" ? c.config.host : "";
      const port = Number(c.config.port ?? 587);
      const user = typeof c.config.username === "string" ? c.config.username : undefined;
      if (!host) return { ok: false, error: "SMTP host not configured" };
      // Channel's own SMTP server, same SDK + React Email path as everything
      // else. 465 = implicit TLS; 587/25 = STARTTLS.
      await sendViaSmtpServer(
        { host, port, secure: port === 465, user, pass: c.secret ?? undefined },
        { to: c.target, subject, react: notification, text: e.message, from: from ?? user ?? "" },
      );
      return { ok: true };
    }
    // Resend: per-channel API key (secret) overrides the env key; blank = env.
    await sendEmail({
      to: c.target,
      subject,
      react: notification,
      text: e.message,
      from,
      apiKey: c.secret ?? undefined,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** FCM push to a device token (or topic). Reuses the install-wide FCM key
 * (Settings → Instance, seeded from FCM_SERVER_KEY), mirroring the per-user
 * push path in ./notify.ts. `target` is the registration token. */
async function deliverPush(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const key = await fcmServerKey();
  if (!key) return { ok: false, error: "FCM not configured" };
  return post("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { Authorization: `key=${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      to: c.target,
      // A tray truncates around 40 characters, so the subject goes in the
      // title: "Deploy failed" on its own does not say which service.
      notification: { title: titleOf(e.title, subjectOf(e.data)), body: e.message },
      data: e.data ?? {},
    }),
  });
}

/**
 * PagerDuty Events API v2.
 *
 * Two fixes here, both defects rather than presentation:
 *
 *   `dedup_key` — without one every occurrence opened a NEW incident, so a
 *   service flapping every two minutes produced an incident every two minutes.
 *   Keyed on the event family, so `health.degraded` and `health.recovered`
 *   address the same incident.
 *
 *   `resolve` — no recovery event ever sent one, so incidents could only be
 *   closed by hand. An `ok` severity is a recovery by definition, and a resolve
 *   needs no payload.
 */
function deliverPagerduty(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const routingKey = c.secret ?? c.target;
  const s = SEVERITY[e.severity];
  const subject = subjectOf(e.data);
  const key = dedupKey(e.eventId, subject);

  const body =
    e.severity === "ok"
      ? { routing_key: routingKey, event_action: "resolve", dedup_key: key }
      : {
          routing_key: routingKey,
          event_action: "trigger",
          dedup_key: key,
          payload: {
            summary: titleOf(e.title, subject),
            source: subject ?? "otterdeploy",
            severity: s.pd,
            component: e.data?.project ?? "instance",
            group: e.eventId.split(".")[0],
            class: e.eventId,
            custom_details: e.data ?? {},
          },
        };

  return post("https://events.pagerduty.com/v2/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
