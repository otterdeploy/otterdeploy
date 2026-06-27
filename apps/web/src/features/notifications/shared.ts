/**
 * Notifications feature — channel routing for deploy / build / health / backup
 * / security events. Types are inferred straight from the oRPC contract so the
 * UI can't drift from the server; the EVENT catalog mirrors the server's
 * PLATFORM_EVENTS (packages/api/src/routers/notifications/events.ts) — the ids
 * MUST stay in lockstep.
 */
import type { channelsCollection, subscriptionsCollection } from "./data/notifications";

export type Channel = (typeof channelsCollection.toArray)[number];
export type Subscription = (typeof subscriptionsCollection.toArray)[number];
export type ChannelKind = Channel["kind"];
export type ChannelStatus = Channel["status"];

export type Severity = "info" | "ok" | "warn" | "err";

export interface EventRow {
  id: string;
  label: string;
  severity: Severity;
}

/** Mirrors PLATFORM_EVENTS on the server — keep ids identical. */
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
  discord: { label: "Discord", search: "Discord", sub: "Discord channel webhook" },
  email: { label: "Email", search: "Email", sub: "Outbound email (Resend)" },
  webhook: { label: "Webhook", search: "Webhook", sub: "Generic POST + HMAC" },
  telegram: { label: "Telegram", search: "Telegram", sub: "Telegram bot" },
  pagerduty: { label: "PagerDuty", search: "PagerDuty", sub: "Events API v2" },
  push: { label: "Push", search: "Firebase", sub: "Mobile / web push (FCM)" },
};

/** Tailwind background class for a severity dot. */
export const SEVERITY_DOT: Record<Severity, string> = {
  info: "bg-sky-500",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  err: "bg-red-500",
};

/** Compact relative time from an ISO string. `null` → "never". */
export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
