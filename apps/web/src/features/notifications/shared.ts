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
  { id: "deploy.crashed", label: "Service crashed", severity: "err" },
  { id: "build.failed", label: "Build failed", severity: "err" },
  { id: "health.degraded", label: "Health degraded", severity: "warn" },
  { id: "health.recovered", label: "Health recovered", severity: "ok" },
  { id: "host.pressure", label: "Server resource pressure", severity: "warn" },
  { id: "cert.expiring", label: "Cert expiring soon", severity: "warn" },
  { id: "cert.renewed", label: "Cert renewed", severity: "ok" },
  { id: "backup.failed", label: "Backup failed", severity: "err" },
  { id: "backup.succeeded", label: "Backup succeeded", severity: "ok" },
  { id: "backup.orphaned", label: "Backup schedule orphaned", severity: "warn" },
  { id: "ssh.rotated", label: "SSH key rotated", severity: "info" },
  { id: "audit.anomaly", label: "Audit anomaly", severity: "warn" },
  { id: "edge.probe", label: "Suspicious edge traffic", severity: "warn" },
];

const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

/** Human label for a delivery-log event id. Test sends log as "test.ping"
 * (outside the subscribable catalog); anything unknown falls back to the raw
 * id so the log never lies. */
export function eventLabel(id: string): string {
  if (id === "test.ping") return "Test ping";
  return EVENT_BY_ID.get(id)?.label ?? id;
}

/** Severity for a delivery-log event id ("test.ping"/unknown → info). */
export function eventSeverityOf(id: string): Severity {
  return EVENT_BY_ID.get(id)?.severity ?? "info";
}

/**
 * Short destination hint for tight spots (matrix column headers). Works on the
 * server-masked target: webhook-ish kinds reduce to the host (the path is
 * already visible on the card), addresses/chat ids show as-is, and anything
 * long is middle-agnostic truncated. Purely presentational — never unmasks.
 */
export function channelTargetHint(kind: ChannelKind, target: string): string {
  let hint = target;
  if (kind === "slack" || kind === "discord" || kind === "webhook") {
    const m = /^https?:\/\/([^/?#]+)/i.exec(target);
    if (m?.[1]) hint = m[1];
  }
  return hint.length > 26 ? `${hint.slice(0, 25)}…` : hint;
}

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

/**
 * `data`-payload keys that are internal plumbing, not user-facing context:
 * `eventId` drives the severity/label (rendered on its own), `occurrence` is
 * the fan-out dedupe key. Both are hidden from the inbox detail rows.
 */
const INBOX_DATA_HIDDEN = new Set(["eventId", "occurrence"]);

/** camelCase / dotted key → spaced, capitalized label ("deploymentId" → "Deployment id"). */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/** The platform `eventId` carried in an inbox notification's `data`, if any —
 *  used to resolve the row's severity + event label. */
export function inboxEventId(data: Record<string, unknown> | null | undefined): string | null {
  const id = data?.eventId;
  return typeof id === "string" && id ? id : null;
}

/**
 * Displayable key/value rows from an inbox notification's `data` payload:
 * internal plumbing keys dropped, empty/nullish values skipped, primitives
 * stringified (objects fall back to JSON). Powers the expanded detail box.
 */
export function inboxDetailRows(
  data: Record<string, unknown> | null | undefined,
): Array<{ key: string; label: string; value: string }> {
  if (!data) return [];
  const rows: Array<{ key: string; label: string; value: string }> = [];
  for (const [key, raw] of Object.entries(data)) {
    if (INBOX_DATA_HIDDEN.has(key)) continue;
    if (raw === null || raw === undefined || raw === "") continue;
    const value =
      typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
        ? String(raw)
        : JSON.stringify(raw);
    rows.push({ key, label: humanizeKey(key), value });
  }
  return rows;
}

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
