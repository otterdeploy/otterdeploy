/**
 * Notification-channel transports. Given a resolved channel (secret already
 * decrypted) and a platform event, push the message to the destination. Pure
 * delivery — the caller (notification.event job) owns DB reads, the delivery
 * log, and retry. Each transport returns a {@link DeliveryResult}; it never
 * throws for an expected provider error (bad webhook, 4xx) so one dead channel
 * can't fail the whole fan-out.
 *
 *   slack/discord — incoming-webhook POST (provider-shaped JSON body)
 *   webhook       — generic POST + optional HMAC-SHA256 signature header
 *   email         — Resend (packages/email)
 *   telegram      — Bot API sendMessage (bot token = secret, chat id = target)
 *   pagerduty     — Events API v2 enqueue (routing key = secret || target)
 */
import { sendEmail } from "@otterdeploy/email";
import { env } from "@otterdeploy/env/server";
import nodemailer from "nodemailer";

export type ChannelKind =
  | "slack"
  | "discord"
  | "email"
  | "webhook"
  | "telegram"
  | "pagerduty"
  | "push";

export interface ResolvedChannel {
  id: string;
  kind: ChannelKind;
  name: string;
  target: string;
  config: Record<string, unknown>;
  /** Decrypted secret (bot token / HMAC key / routing key), or null. */
  secret: string | null;
}

export interface ChannelEvent {
  eventId: string;
  /** Severity hint for providers that style by level (info|ok|warn|err). */
  severity: "info" | "ok" | "warn" | "err";
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

/** Per-severity presentation for rich Slack/Discord messages. `discord` is a
 * decimal color int (embed sidebar); `slack` is a hex string (attachment bar). */
const STYLE: Record<
  ChannelEvent["severity"],
  { discord: number; slack: string; emoji: string }
> = {
  err: { discord: 0xef4444, slack: "#ef4444", emoji: "🔴" },
  warn: { discord: 0xf59e0b, slack: "#f59e0b", emoji: "🟠" },
  ok: { discord: 0x10b981, slack: "#10b981", emoji: "🟢" },
  info: { discord: 0x0ea5e9, slack: "#0ea5e9", emoji: "🔵" },
};

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

/** Wrap a fetch so a thrown/network error becomes a DeliveryResult, not a throw. */
async function post(
  url: string,
  init: RequestInit,
): Promise<DeliveryResult> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
  }
  return { ok: true };
}

function deliverSlack(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const s = STYLE[e.severity];
  const fieldParts: string[] = [];
  if (typeof e.data?.project === "string")
    fieldParts.push(`*Project*\n${e.data.project}`);
  if (typeof e.data?.resource === "string")
    fieldParts.push(`*Resource*\n${e.data.resource}`);

  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${s.emoji} *${e.title}*\n${e.message}` },
    },
  ];
  if (fieldParts.length)
    blocks.push({
      type: "section",
      fields: fieldParts.map((text) => ({ type: "mrkdwn", text })),
    });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `otterdeploy · \`${e.eventId}\`` }],
  });

  return post(c.target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // `username` posts under the channel's display name; a colored attachment
    // gives the message a severity sidebar instead of a bare line of text.
    body: JSON.stringify({ username: c.name, attachments: [{ color: s.slack, blocks }] }),
  });
}

function deliverDiscord(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const s = STYLE[e.severity];
  // Surface project/resource (when the emitter provided them) as inline fields.
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (typeof e.data?.project === "string")
    fields.push({ name: "Project", value: e.data.project, inline: true });
  if (typeof e.data?.resource === "string")
    fields.push({ name: "Resource", value: e.data.resource, inline: true });

  return post(c.target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: c.name,
      embeds: [
        {
          title: `${s.emoji} ${e.title}`,
          description: e.message,
          color: s.discord,
          ...(fields.length ? { fields } : {}),
          footer: { text: `otterdeploy · ${e.eventId}` },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}

async function deliverWebhook(
  c: ResolvedChannel,
  e: ChannelEvent,
): Promise<DeliveryResult> {
  const body = JSON.stringify({
    event: e.eventId,
    severity: e.severity,
    title: e.title,
    message: e.message,
    data: e.data ?? {},
    channel: c.name,
  });
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Optional HMAC-SHA256 over the raw body so receivers can verify origin.
  if (c.secret) {
    headers["x-otterdeploy-signature"] = `sha256=${await hmacSha256Hex(c.secret, body)}`;
  }
  return post(c.target, { method: "POST", headers, body });
}

async function deliverEmail(
  c: ResolvedChannel,
  e: ChannelEvent,
): Promise<DeliveryResult> {
  const from = typeof c.config.from === "string" ? c.config.from : undefined;
  const subject = `[otterdeploy] ${e.title}`;
  // `client` picks the transport: "smtp" uses the channel's own SMTP server
  // (config host/port/user + secret password); anything else uses Resend.
  const client = c.config.client === "smtp" ? "smtp" : "resend";

  try {
    if (client === "smtp") {
      const host = String(c.config.host ?? "");
      const port = Number(c.config.port ?? 587);
      const user = typeof c.config.username === "string" ? c.config.username : undefined;
      if (!host) return { ok: false, error: "SMTP host not configured" };
      const transporter = nodemailer.createTransport({
        host,
        port,
        // 465 = implicit TLS; 587/25 = STARTTLS.
        secure: port === 465,
        auth: user && c.secret ? { user, pass: c.secret } : undefined,
      });
      await transporter.sendMail({
        from: from ?? user,
        to: c.target,
        subject,
        text: e.message,
      });
      return { ok: true };
    }
    // Resend: per-channel API key (secret) overrides the env key; blank = env.
    await sendEmail({
      to: c.target,
      subject,
      text: e.message,
      from,
      apiKey: c.secret ?? undefined,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** FCM push to a device token (or topic) — reuses FCM_SERVER_KEY, mirroring
 * the per-user push path in ./notify.ts. `target` is the registration token. */
function deliverPush(c: ResolvedChannel, e: ChannelEvent): Promise<DeliveryResult> {
  const key = env.FCM_SERVER_KEY;
  if (!key) return Promise.resolve({ ok: false, error: "FCM not configured" });
  return post("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { Authorization: `key=${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      to: c.target,
      notification: { title: e.title, body: e.message },
      data: e.data ?? {},
    }),
  });
}

function deliverTelegram(
  c: ResolvedChannel,
  e: ChannelEvent,
): Promise<DeliveryResult> {
  if (!c.secret) return Promise.resolve({ ok: false, error: "no bot token" });
  return post(`https://api.telegram.org/bot${c.secret}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: c.target,
      text: `${e.title}\n${e.message}`,
    }),
  });
}

function deliverPagerduty(
  c: ResolvedChannel,
  e: ChannelEvent,
): Promise<DeliveryResult> {
  const routingKey = c.secret ?? c.target;
  // PagerDuty only accepts critical/warning/error/info as severities.
  const pdSeverity =
    e.severity === "err" ? "error" : e.severity === "ok" ? "info" : e.severity;
  return post("https://events.pagerduty.com/v2/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      routing_key: routingKey,
      event_action: "trigger",
      payload: {
        summary: `${e.title} — ${e.message}`,
        source: "otterdeploy",
        severity: pdSeverity,
        custom_details: e.data ?? {},
      },
    }),
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
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
