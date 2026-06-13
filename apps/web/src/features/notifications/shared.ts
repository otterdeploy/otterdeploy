/**
 * Notifications feature — channel routing for deploy / build / health /
 * security events. Ported from the design demo (apps/web-demo). There is no
 * channel-routing backend yet, so the page runs on local seed state; swap the
 * seeds for oRPC queries once a `notification.channels` router lands.
 */

export type ChannelKind =
  | "slack"
  | "discord"
  | "email"
  | "webhook"
  | "telegram"
  | "pagerduty";

export type ChannelStatus = "active" | "warn" | "paused" | "disconnected";

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  target: string;
  transport: string;
  events7d: number;
  lastDelivery: string;
  status: ChannelStatus;
  note?: string;
}

export const CHANNELS_SEED: Channel[] = [
  {
    id: "ch_slack",
    name: "#otterdeploy-deploys",
    kind: "slack",
    target: "hooks.slack.com/services/T0XXX/B0YYY/zzz••••",
    transport: "incoming-webhook",
    events7d: 142,
    lastDelivery: "4m ago",
    status: "active",
  },
  {
    id: "ch_discord",
    name: "#alerts",
    kind: "discord",
    target: "discord.com/api/webhooks/8841…/••••",
    transport: "webhook",
    events7d: 38,
    lastDelivery: "2h ago",
    status: "active",
  },
  {
    id: "ch_email",
    name: "oncall@paperhouse.dev",
    kind: "email",
    target: "oncall@paperhouse.dev",
    transport: "SMTP via Postmark",
    events7d: 12,
    lastDelivery: "4h ago",
    status: "active",
  },
  {
    id: "ch_webhook",
    name: "helio-oncall webhook",
    kind: "webhook",
    target: "https://hooks.helio.so/oncall",
    transport: "POST · HMAC-SHA256",
    events7d: 27,
    lastDelivery: "31m ago",
    status: "warn",
    note: "3 failed deliveries in 24h",
  },
  {
    id: "ch_telegram",
    name: "Telegram",
    kind: "telegram",
    target: "—",
    transport: "bot · long-poll",
    events7d: 0,
    lastDelivery: "never",
    status: "disconnected",
  },
];

export type Severity = "info" | "ok" | "warn" | "err";

export interface EventRow {
  id: string;
  label: string;
  severity: Severity;
}

export const EVENTS: EventRow[] = [
  { id: "deploy.started", label: "Deploy started", severity: "info" },
  { id: "deploy.succeeded", label: "Deploy succeeded", severity: "ok" },
  { id: "deploy.failed", label: "Deploy failed", severity: "err" },
  { id: "build.failed", label: "Build failed", severity: "err" },
  { id: "health.degraded", label: "Health degraded", severity: "warn" },
  { id: "health.recovered", label: "Health recovered", severity: "ok" },
  { id: "cert.expiring", label: "Cert expiring soon", severity: "warn" },
  { id: "cert.renewed", label: "Cert renewed", severity: "ok" },
  { id: "backup.failed", label: "Backup failed", severity: "err" },
  { id: "backup.succeeded", label: "Backup succeeded", severity: "ok" },
  { id: "ssh.rotated", label: "SSH key rotated", severity: "info" },
  { id: "audit.anomaly", label: "Audit anomaly", severity: "warn" },
];

// Default subscription matrix: channel id → set of event ids.
export const DEFAULT_SUBS: Record<string, Set<string>> = {
  ch_slack: new Set([
    "deploy.started",
    "deploy.succeeded",
    "deploy.failed",
    "build.failed",
    "health.degraded",
    "health.recovered",
  ]),
  ch_discord: new Set([
    "deploy.failed",
    "build.failed",
    "health.degraded",
    "audit.anomaly",
  ]),
  ch_email: new Set([
    "cert.expiring",
    "cert.renewed",
    "backup.failed",
    "audit.anomaly",
  ]),
  ch_webhook: new Set([
    "deploy.failed",
    "health.degraded",
    "audit.anomaly",
    "backup.failed",
  ]),
  ch_telegram: new Set(),
};

interface KindMeta {
  label: string;
  /** Brand key for SvglLogo; unmatched kinds fall back to a letter monogram. */
  search: string;
  sub: string;
}

export const KIND_META: Record<ChannelKind, KindMeta> = {
  slack: {
    label: "Slack",
    search: "Slack",
    sub: "Slack workspace · incoming webhook",
  },
  discord: {
    label: "Discord",
    search: "Discord",
    sub: "Discord channel webhook",
  },
  email: { label: "Email", search: "Email", sub: "Outbound SMTP" },
  webhook: { label: "Webhook", search: "Webhook", sub: "Generic POST + HMAC" },
  telegram: { label: "Telegram", search: "Telegram", sub: "Telegram bot" },
  pagerduty: {
    label: "PagerDuty",
    search: "PagerDuty",
    sub: "Events API v2",
  },
};

/** Tailwind background class for a severity dot. */
export const SEVERITY_DOT: Record<Severity, string> = {
  info: "bg-sky-500",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  err: "bg-red-500",
};
