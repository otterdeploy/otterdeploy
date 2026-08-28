/**
 * Shared presentation for notification transports: the severity badge, the
 * subject line, and the aligned detail table every rich channel renders.
 *
 * Split from ./channels.ts so that file stays a list of transports. These are
 * the decisions that must read the same on Discord, Slack, Telegram and email —
 * keeping them in one place is what stops the four drifting apart.
 *
 * ── WHY AN EMOJI CARRIES SEVERITY ──────────────────────────────────────────
 * Discord and Slack used to draw a coloured stripe down the left edge, and the
 * title repeated it with an emoji. The stripe is gone: on Discord it forced the
 * embed's left indent, which on a phone made every alert feel boxed-in, and it
 * duplicated information the emoji was already carrying.
 *
 * That leaves the question of where severity goes. Discord's newer container
 * components render markdown, and MARKDOWN HAS NO COLOUR — there is no way to
 * colour a word in a container. The alternatives were an `ansi` code fence
 * (colour, but Solarized values rather than ours, and only inside a code block),
 * an ANSI background (no green and no amber in the palette), or a disabled
 * button (Discord has no amber button, and `warn` is a third of the catalog).
 *
 * A unicode dot is the only mechanism that renders all four severities, in
 * every client, with no setup. It is the same four colours as the old stripe.
 */

import { Temporal } from "@otterdeploy/shared/temporal";

export type Severity = "info" | "ok" | "warn" | "err";

/** Module-private: callers read SEVERITY, they do not build one. */
interface SeverityStyle {
  /** Decimal int, for any provider that still takes a colour (email, push). */
  hex: number;
  /** Hex string form of the same colour. */
  css: string;
  /** The badge. Carries severity everywhere the stripe used to. */
  emoji: string;
  /** Severity-level word, never event-specific: this module only knows the
   *  severity, so "CRITICAL" is always true where "FAILED" would not be
   *  (`deploy.crashed` is a crash, `host.pressure` is neither). */
  word: string;
  /** PagerDuty only accepts critical/warning/error/info. */
  pd: string;
}

export const SEVERITY: Record<Severity, SeverityStyle> = {
  err: { hex: 0xef4444, css: "#ef4444", emoji: "🔴", word: "CRITICAL", pd: "error" },
  warn: { hex: 0xf59e0b, css: "#f59e0b", emoji: "🟠", word: "WARNING", pd: "warning" },
  ok: { hex: 0x10b981, css: "#10b981", emoji: "🟢", word: "OK", pd: "info" },
  info: { hex: 0x0ea5e9, css: "#0ea5e9", emoji: "🔵", word: "INFO", pd: "info" },
};

/** Keys that identify WHAT an event is about rather than describing it. They
 *  are promoted into the title and must not repeat in the detail table. */
const SUBJECT_KEYS = ["resource", "service", "database", "server", "domain", "project"];

/**
 * The thing the event happened to, for the title.
 *
 * Derived from `data` rather than added to the emitter contract: every emitter
 * already passes `resource` or `project`, so this needs no change at ~14 call
 * sites and no migration. An emitter that passes neither simply gets a title
 * without a subject, which is what it renders today.
 */
export function subjectOf(data: Record<string, string> | undefined): string | undefined {
  if (!data) return undefined;
  for (const key of SUBJECT_KEYS) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** `Deploy failed · authentik-server`. Two `deploy.failed` alerts a second
 *  apart used to be indistinguishable until you read the body. */
export function titleOf(title: string, subject: string | undefined): string {
  return subject === undefined ? title : `${title} · ${subject}`;
}

/** Detail rows, minus whatever the title already says. */
export function detailRows(
  data: Record<string, string> | undefined,
  subject: string | undefined,
): Array<[string, string]> {
  if (!data) return [];
  return Object.entries(data).filter(([, value]) => value !== subject && value.length > 0);
}

/** `first_seen` → `First seen`. Emitters pass snake_case keys; humans read these. */
export function label(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/[_-]/g, " ");
}

/** Telegram's HTML parse mode rejects a message containing a stray `<` or `&`,
 *  and a rejected message is a dropped alert. Values are tenant data (image
 *  refs, log lines, paths), so they are escaped rather than trusted. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A fixed-width table for clients that render code blocks (Discord, Telegram).
 *
 * A code fence is the ONLY way to align columns in Discord: markdown has no
 * table syntax and the field grid does not align across rows. The cost is that
 * code blocks do not wrap, so an over-wide row scrolls sideways on a phone —
 * which is why values are clipped to keep the widest line inside ~34 columns.
 */
export function alignedTable(rows: Array<[string, string]>): string | undefined {
  if (rows.length === 0) return undefined;
  const labelled: Array<[string, string]> = rows.map(([k, v]) => [label(k), clip(v, 30)]);
  const width = Math.max(...labelled.map(([k]) => k.length));
  return labelled.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join("\n");
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * The incident identity PagerDuty groups on.
 *
 * Without one, every occurrence opens a NEW incident, so a service flapping
 * every two minutes produces an incident every two minutes instead of one that
 * updates. Keyed on the event FAMILY rather than the full id so that
 * `health.degraded` and `health.recovered` address the same incident — which is
 * what lets a recovery resolve it.
 */
export function dedupKey(eventId: string, subject: string | undefined): string {
  const family = eventId.split(".")[0] ?? eventId;
  return `otterdeploy/${family}/${subject ?? "instance"}`;
}

/**
 * What the alert's one action should be called.
 *
 * Derived from the event family, because that is all this module knows. It is
 * deliberately NOT event-specific beyond the family: "View build log" is right
 * for every deploy and build event and wrong for none of them, whereas a
 * per-event label would have to live with the emitters.
 */
export function actionLabel(eventId: string): string {
  switch (eventId.split(".")[0]) {
    case "deploy":
    case "build":
      return "View build log";
    case "backup":
      return "Open backups";
    case "health":
    case "host":
      return "Open service";
    case "cert":
      return "Open domains";
    case "edge":
      return "Review and block";
    case "audit":
      return "Review audit log";
    default:
      return "Open in otterdeploy";
  }
}

/**
 * Where that action points.
 *
 * An emitter that knows the exact page passes `url` and it wins. Nothing does
 * yet — `ChannelEvent.url` is new and additive — so the fallback is the app
 * root, which is always a true destination even when it is not a precise one.
 * Returns undefined when the install has no public URL configured, and the
 * caller then renders no button rather than a dead one.
 */
export function actionUrl(url: string | undefined, webUrl: string | undefined): string | undefined {
  return url ?? webUrl ?? undefined;
}

/** ISO-8601 instant. Temporal per the repo's time rule; no `new Date()`. */
export function nowIso(): string {
  return Temporal.Now.instant().toString();
}
