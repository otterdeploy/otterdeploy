/**
 * Notifications feature: channel routing for deploy / build / health / backup
 * / security events. Types are inferred straight from the oRPC contract so the
 * UI can't drift from the server; the EVENT catalog mirrors the server's
 * PLATFORM_EVENTS (packages/api/src/routers/notifications/events.ts): the ids
 * MUST stay in lockstep.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { timeAgo } from "@/shared/lib/time";

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
  /** Mirrors the server's flag: an id nothing emits yet. Present in the
   *  catalog so severity still resolves for any row already stored, absent
   *  from {@link SUBSCRIBABLE_EVENTS} so the matrix never offers it. */
  wired?: false;
}

/** Mirrors PLATFORM_EVENTS on the server: keep ids AND the `wired` flag
 *  identical (packages/api/src/routers/notifications/events.ts). */
export const EVENTS: EventRow[] = [
  { id: "deploy.started", label: "Deploy started", severity: "info" },
  { id: "deploy.succeeded", label: "Deploy succeeded", severity: "ok" },
  { id: "deploy.failed", label: "Deploy failed", severity: "err" },
  { id: "deploy.crashed", label: "Service crashed", severity: "err" },
  { id: "build.failed", label: "Build failed", severity: "err" },
  { id: "health.degraded", label: "Health degraded", severity: "warn" },
  { id: "health.recovered", label: "Health recovered", severity: "ok" },
  { id: "host.pressure", label: "Server resource pressure", severity: "warn" },
  { id: "cert.expiring", label: "Cert expiring soon", severity: "warn", wired: false },
  { id: "cert.renewed", label: "Cert renewed", severity: "ok" },
  { id: "backup.failed", label: "Backup failed", severity: "err" },
  { id: "backup.succeeded", label: "Backup succeeded", severity: "ok" },
  { id: "backup.orphaned", label: "Backup schedule orphaned", severity: "warn" },
  { id: "backup.overdue", label: "Backups overdue", severity: "warn" },
  { id: "backup.verify-failed", label: "Backup verification failed", severity: "err" },
  { id: "ssh.rotated", label: "SSH key rotated", severity: "info" },
  { id: "audit.anomaly", label: "Audit anomaly", severity: "warn" },
  { id: "edge.probe", label: "Suspicious edge traffic", severity: "warn" },
];

/** What the subscription matrix renders: only events something can actually
 *  emit. Subscribing to a row that can never fire is a promise the product
 *  cannot keep, so it is not offered. */
export const SUBSCRIBABLE_EVENTS: EventRow[] = EVENTS.filter((e) => e.wired !== false);

/**
 * Worst-first severity order, the same rank the bell badge resolves ties on
 * (SEVERITY_RANK below). A failure band is never listed under the successes.
 */
const SEVERITY_ORDER: readonly Severity[] = ["err", "warn", "info", "ok"];

/**
 * The subscribable catalog grouped into severity bands, worst-first.
 *
 * Severity is a static property of an event, never something you configure, so
 * it earns a band header rather than a column: one row per band instead of one
 * cell per event. It also matches how the decision is actually made — nobody
 * wants "deploy.failed and build.failed and backup.failed", they want "page me
 * on failures, stay quiet otherwise" — which is what makes a per-band toggle
 * worth having.
 *
 * Computed once at module load: the catalog is a frozen literal, so there is
 * nothing to recompute per render.
 */
export const EVENT_BANDS: ReadonlyArray<{
  severity: Severity;
  events: readonly EventRow[];
}> = SEVERITY_ORDER.map((severity) => ({
  severity,
  events: SUBSCRIBABLE_EVENTS.filter((e) => e.severity === severity),
})).filter((band) => band.events.length > 0);

/** i18n key per band, named for what the band MEANS to an operator deciding
 *  whether to be woken up, not for the enum value. `as const` keeps these as
 *  literal types: `t()` takes a union of known key paths and a widened
 *  `string` fails to match it. */
export const SEVERITY_GROUP_KEY = {
  err: "notifications.groupErr",
  warn: "notifications.groupWarn",
  info: "notifications.groupInfo",
  ok: "notifications.groupOk",
} as const satisfies Record<Severity, string>;

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
 * long is middle-agnostic truncated. Purely presentational, never unmasks.
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

/** The platform `eventId` carried in an inbox notification's `data`, if any.
 *  Used to resolve the row's severity + event label. */
export function inboxEventId(data: JsonObject | null | undefined): string | null {
  const id = data?.eventId;
  return typeof id === "string" && id ? id : null;
}

/**
 * Displayable key/value rows from an inbox notification's `data` payload:
 * internal plumbing keys dropped, empty/nullish values skipped, primitives
 * stringified (objects fall back to JSON). Powers the expanded detail box.
 */
export function inboxDetailRows(
  data: JsonObject | null | undefined,
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

/**
 * Severity colours for the header-bell BADGE specifically.
 *
 * Deliberately the semantic tokens rather than {@link SEVERITY_DOT}'s palette
 * classes: the badge sits in the header chrome, which is themed, and the tokens
 * carry a light/dark pair (index.css) where `bg-red-500` is one fixed hue. The
 * popover rows below keep SEVERITY_DOT. They sit on a surface where the
 * palette reads correctly in both themes.
 */
export const SEVERITY_BADGE: Record<Severity, string> = {
  info: "bg-info",
  ok: "bg-success",
  warn: "bg-warning",
  err: "bg-destructive",
};

/** Worst-first, so a single failure is never buried under newer chatter. */
const SEVERITY_RANK: readonly Severity[] = ["err", "warn", "info", "ok"];

/**
 * The headline severity across `items`, or null when there's nothing to report.
 *
 * The bell badge summarizes many notifications in one 8px dot, so it has to pick
 * ONE, and the only safe pick is the most concerning, matching how
 * `rollupStatus` (build-live-nodes.ts) and the app-status rollup resolve ties.
 * Callers pass the unread subset; a read failure is history, not a badge.
 */
export function worstSeverity(items: readonly { data: JsonObject | null }[]): Severity | null {
  if (items.length === 0) return null;
  const present = new Set<Severity>();
  for (const item of items) {
    const id = inboxEventId(item.data);
    present.add(id ? eventSeverityOf(id) : "info");
  }
  return SEVERITY_RANK.find((s) => present.has(s)) ?? null;
}

/** Compact relative time from an ISO string. `null` → "never", which is a
 *  claim about the channel (it has never delivered) and not a timestamp. */
export function relativeTime(iso: string | null): string {
  return iso === null ? "never" : timeAgo(iso);
}

/**
 * Which of the four bodies the inbox popover shows.
 *
 * A function rather than a chain of ternaries inline in the JSX, because the
 * ORDER is the correctness property and it deserves a name and a test. A
 * failed request leaves the item list empty, so checking `empty` before
 * `error` renders "No notifications yet" for a request that 500'd, timed out,
 * or lost its session: the app asserting nothing happened when in truth it
 * could not find out. That is the bug this encodes against.
 */
export type InboxViewState = "loading" | "error" | "empty" | "list";

export function inboxViewState(query: {
  isLoading: boolean;
  isError: boolean;
  itemCount: number;
}): InboxViewState {
  if (query.isLoading) return "loading";
  // Before `empty`, always.
  if (query.isError) return "error";
  return query.itemCount === 0 ? "empty" : "list";
}

/**
 * Unread rows the page could not carry.
 *
 * `unread` is counted server-side across every unread row; `items` is capped at
 * the requested page size. The difference is what the operator cannot see, and
 * it matters because "Mark all read" clears ALL unread rows, not just the
 * rendered ones — so without surfacing this, the button silently discards
 * notifications that were never shown.
 */
export function hiddenUnreadCount(input: { unread: number; itemCount: number }): number {
  return Math.max(0, input.unread - input.itemCount);
}
