import { NotificationEmail, sendEmail, sendViaSmtpServer } from "@otterdeploy/email";
import { parseSmtpTlsMode } from "@otterdeploy/email/smtp-tls";
import { env } from "@otterdeploy/env/server";

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
 *   pagerduty: Events API v2 enqueue, change events for `info` (routing key = secret || target)
 *   push: FCM HTTP v1 (install-wide service account, token/topic = target)
 *
 * `channel.target` is tenant-supplied for slack/discord/webhook (a URL the
 * org pasted in): every transport POSTs through `post()`, which routes
 * through the shared egress policy: resolves and validates every address
 * (loopback/private/link-local/metadata ranges and the control plane's own
 * identity denied by default), pins the connection to the validated
 * address, and re-validates every redirect hop. See
 * packages/shared/src/egress-policy.ts. Fixed-URL transports (FCM,
 * PagerDuty) go through the same helper for consistency, with redirects off
 * (a provider API that redirects a POST has refused it).
 */
import type { ChannelEvent, DeliveryResult, ResolvedChannel } from "./types";

import { deliverDiscord, deliverSlack, deliverTelegram } from "./chat-transports";
import { sendFcm } from "./fcm";
import {
  SEVERITY,
  TEXT_LIMIT,
  actionLabel,
  actionUrl,
  dedupKey,
  nowIso,
  subjectOf,
  titleOf,
  truncatedText,
} from "./message";
import { FCM_LEGACY_KEY_ERROR, fcmCredentials } from "./platform-transports";
import { post } from "./post";
import { webhookChannelHeaders } from "./webhook-headers";

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
  // Signed (timestamped, replay-checkable) when the channel has a secret.
  const headers = await webhookChannelHeaders(c.secret, body);
  return post(c.target, { method: "POST", headers, body });
}

async function deliverEmail(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const from = typeof c.config.from === "string" ? c.config.from : undefined;
  const s = SEVERITY[e.severity];
  const subject = subjectOf(e.data);
  // The emoji leads the SUBJECT because an inbox lists subject lines and
  // nothing else: it is the only severity signal available before the mail is
  // opened, and the one place it decides whether the mail gets opened at all.
  // "[otterdeploy]" moves to the end — a prefix every message shares spends the
  // first characters of every row saying nothing.
  const emailSubject = `${s.emoji} ${titleOf(e.title, subject)} — otterdeploy`;
  const href = actionUrl(e.url, env.PUBLIC_WEB_URL);
  // Every channel email is the same React Email component, never a raw HTML
  // string. The SMTP branch renders it here (it uses the channel's own server,
  // so it can't go through sendEmail); the Resend branch hands the element off.
  const notification = NotificationEmail({
    title: titleOf(e.title, subject),
    message: e.message,
    severity: e.severity,
    data: e.data,
    eventId: e.eventId,
    actionUrl: href,
    actionLabel: actionLabel(e.eventId),
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
      // else. `config.tlsMode` ("none" | "starttls" | "implicit") states the
      // TLS choice explicitly; without it, 465 = implicit TLS and
      // anything else the legacy STARTTLS-when-authenticated default.
      await sendViaSmtpServer(
        {
          host,
          port,
          secure: port === 465,
          tlsMode: parseSmtpTlsMode(c.config.tlsMode),
          user,
          pass: c.secret ?? undefined,
        },
        {
          to: c.target,
          subject: emailSubject,
          react: notification,
          text: e.message,
          from: from ?? user ?? "",
        },
      );
      return { ok: true };
    }
    // Resend: per-channel API key (secret) overrides the env key; blank = env.
    await sendEmail({
      to: c.target,
      subject: emailSubject,
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

/** FCM HTTP v1 push to a device token (or `/topics/<name>`), with the
 *  install-wide service account (FCM_SERVICE_ACCOUNT_JSON), the same
 *  credentials as the per-user push path in ./notify.ts. `target` is the
 *  registration token. */
async function deliverPush(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const credentials = await fcmCredentials();
  switch (credentials.kind) {
    case "none":
      return { ok: false, error: "FCM not configured: set FCM_SERVICE_ACCOUNT_JSON" };
    case "legacy-key":
      return { ok: false, error: FCM_LEGACY_KEY_ERROR };
    case "invalid":
      return { ok: false, error: credentials.error };
    case "service-account":
      return sendFcm(credentials.account, {
        target: c.target,
        // A tray truncates around 40 characters, so the subject goes in the
        // title: "Deploy failed" on its own does not say which service.
        title: titleOf(e.title, subjectOf(e.data)),
        body: e.message,
        data: e.data,
      });
  }
}

/**
 * PagerDuty Events API v2.
 *
 * Three decisions here, all defects rather than presentation:
 *
 *   `dedup_key` — without one every occurrence opened a NEW incident, so a
 *   service flapping every two minutes produced an incident every two minutes.
 *   Keyed on the event family, so `health.degraded` and `health.recovered`
 *   address the same incident.
 *
 *   `resolve` — no recovery event ever sent one, so incidents could only be
 *   closed by hand. An `ok` severity is a recovery by definition, and a resolve
 *   needs no payload.
 *
 *   `info` is a change event, not an alert. Every non-`ok` event used to be a
 *   `trigger`, so any informational event a channel subscribed to paged
 *   someone. PagerDuty's Change Events API (`/v2/change/enqueue`) records it on
 *   the service's timeline without opening an incident.
 */
function deliverPagerduty(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const routingKey = c.secret ?? c.target;
  const s = SEVERITY[e.severity];
  const subject = subjectOf(e.data);
  const key = dedupKey(e.eventId, subject);
  const summary = truncatedText(titleOf(e.title, subject), TEXT_LIMIT.pagerdutySummary);
  const options = { followRedirects: false };

  if (e.severity === "info") {
    return post(
      "https://events.pagerduty.com/v2/change/enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          routing_key: routingKey,
          payload: {
            summary,
            source: subject ?? "otterdeploy",
            timestamp: nowIso(),
            custom_details: e.data ?? {},
          },
        }),
      },
      options,
    );
  }

  const body =
    e.severity === "ok"
      ? { routing_key: routingKey, event_action: "resolve", dedup_key: key }
      : {
          routing_key: routingKey,
          event_action: "trigger",
          dedup_key: key,
          payload: {
            summary,
            source: subject ?? "otterdeploy",
            severity: s.pd,
            component: e.data?.project ?? "instance",
            group: e.eventId.split(".")[0],
            class: e.eventId,
            custom_details: e.data ?? {},
          },
        };

  return post(
    "https://events.pagerduty.com/v2/enqueue",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
}
