/**
 * Folding the inbox for the popover: settled history under its subject, and
 * what the bell shows. Split from shared.ts (over the file-size cap) and kept
 * pure so the shapes can be pinned in shared.test.ts without a DOM.
 */
import type { InboxSubject } from "@otterdeploy/shared/inbox-subject";
import type { JsonObject } from "@otterdeploy/shared/json";

import { decodeSubject } from "@otterdeploy/shared/inbox-subject";

import { type HiddenConditions, isHidden } from "./inbox-hidden";
import { eventSeverityOf, inboxEventId, SEVERITY_RANK, type Severity } from "./shared";

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
  const present = new Set<Severity>(items.map((item) => itemSeverity(item.data)));
  return SEVERITY_RANK.find((s) => present.has(s)) ?? null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Severity of one inbox row.
 *
 * The catalog's, except for `host.pressure`, which is one id covering three
 * grades: the emitter writes `data.severity` and "0.1 GB of 24 GB left" must
 * not be painted the same amber as "2.7 GB in unused images".
 */
export function itemSeverity(data: JsonObject | null | undefined): Severity {
  const id = inboxEventId(data);
  if (id === "host.pressure") {
    const graded = str(data?.severity);
    if (graded === "critical") return "err";
    if (graded === "warning") return "warn";
    if (graded === "info") return "info";
  }
  return id ? eventSeverityOf(id) : "info";
}

/**
 * What a row is about.
 *
 * Emitters now write a subject (@otterdeploy/shared/inbox-subject). Rows
 * written before that carry only display strings, so they get a best-effort
 * subject with a `legacy:` id: enough to group under a name, never enough to
 * link, and never confused with a real id.
 */
export function subjectOfItem(data: JsonObject | null | undefined): InboxSubject | null {
  const decoded = decodeSubject(data);
  if (decoded) return decoded;
  if (!data) return null;
  const resource = str(data.resource);
  if (resource) return { kind: "service", id: `legacy:${resource}`, label: resource };
  if (str(data.recommendation)) return { kind: "server", id: "legacy:host", label: "This server" };
  const volume = str(data.volume);
  if (volume) return { kind: "backup", id: `legacy:vol:${volume}`, label: volume };
  const domains = str(data.domains);
  if (domains) return { kind: "edge", id: `legacy:${domains}`, label: domains };
  return null;
}

interface SettledSource {
  id: string;
  title: string;
  data: JsonObject | null;
  readAt: Date | null;
  createdAt: Date;
}

/** One line of settled history: a row, or a run of identical rows folded. */
export interface SettledRow<T extends SettledSource> {
  item: T;
  /** How many identical rows this line stands for. */
  count: number;
  ids: T["id"][];
  unread: boolean;
}

export interface SettledGroup<T extends SettledSource> {
  key: string;
  subject: InboxSubject | null;
  rows: SettledRow<T>[];
  unread: number;
  /** Worst unread severity, or null when everything here is read. */
  severity: Severity | null;
  latestAt: number;
}

/**
 * Settled history grouped under what it is about, worst-unread first.
 *
 * Within a group, a run of rows with the same event and title (a condition
 * that re-notified before the emitter learned to stay quiet) folds into one
 * line with a count, so history is a list of things that happened rather
 * than a list of times the same thing was said. `items` must be newest first.
 */
export function groupSettled<T extends SettledSource>(items: readonly T[]): SettledGroup<T>[] {
  const groups = new Map<string, SettledGroup<T>>();
  for (const item of items) {
    const subject = subjectOfItem(item.data);
    const key = subject ? `${subject.kind}:${subject.id}` : "other";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        subject,
        rows: [],
        unread: 0,
        severity: null,
        latestAt: item.createdAt.getTime(),
      };
      groups.set(key, group);
    }
    const unread = item.readAt === null;
    const last = group.rows[group.rows.length - 1];
    if (
      last &&
      last.item.title === item.title &&
      inboxEventId(last.item.data) === inboxEventId(item.data)
    ) {
      last.count += 1;
      last.ids.push(item.id);
      last.unread ||= unread;
    } else {
      group.rows.push({ item, count: 1, ids: [item.id], unread });
    }
    if (unread) {
      group.unread += 1;
      const severity = itemSeverity(item.data);
      if (
        group.severity === null ||
        SEVERITY_RANK.indexOf(severity) < SEVERITY_RANK.indexOf(group.severity)
      ) {
        group.severity = severity;
      }
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.unread > 0 !== b.unread > 0) return a.unread > 0 ? -1 : 1;
    const ra = a.severity ? SEVERITY_RANK.indexOf(a.severity) : SEVERITY_RANK.length;
    const rb = b.severity ? SEVERITY_RANK.indexOf(b.severity) : SEVERITY_RANK.length;
    return ra - rb || b.latestAt - a.latestAt;
  });
}

/**
 * What the bell shows.
 *
 * Open problems first: their count in the worst colour, and that number goes
 * to zero when the problems are fixed, not when someone clicks through. With
 * nothing open, the unread count in the quiet colour, so a deploy that
 * succeeded while you were away still lights the bell without alarming.
 */
export function bellState(input: {
  open: readonly { severity: Severity }[];
  unread: number;
}): { count: number; severity: Severity } | null {
  if (input.open.length > 0) {
    const present = new Set(input.open.map((c) => c.severity));
    return {
      count: input.open.length,
      severity: SEVERITY_RANK.find((s) => present.has(s)) ?? "warn",
    };
  }
  if (input.unread > 0) return { count: input.unread, severity: "info" };
  return null;
}

interface OpenLike {
  key: string;
  occurrenceIds: readonly string[];
  unreadCount: number;
  severity: Severity;
}

export interface InboxView<T extends SettledSource, C extends OpenLike> {
  /** Open conditions the viewer has not snoozed or dismissed. */
  attention: C[];
  groups: SettledGroup<T>[];
  /** Unread rows beyond what the popover can show. */
  hiddenUnread: number;
  /** Every unread settled row on screen: what "Clear settled" marks. */
  settledUnreadIds: T["id"][];
  badge: { count: number; severity: Severity } | null;
}

/**
 * Everything the popover renders, from one list response.
 *
 * A function rather than a stretch of the component, so the arithmetic that
 * decides what the bell says and what "older unread not shown" means can be
 * pinned in a test. Unread rows the popover CAN show are every settled row
 * in the page plus every occurrence inside an open card (a dismissed card
 * still counts: dismissing marked it read); what is left is beyond the page.
 */
export function deriveInboxView<T extends SettledSource, C extends OpenLike>(input: {
  open: readonly C[];
  items: readonly T[];
  unread: number;
  hidden: HiddenConditions;
  now: number;
}): InboxView<T, C> {
  const attention = input.open.filter((c) => !isHidden(input.hidden, c, input.now));
  const groups = groupSettled(input.items);
  const shownUnread =
    input.items.filter((i) => i.readAt === null).length +
    input.open.reduce((sum, c) => sum + c.unreadCount, 0);
  return {
    attention,
    groups,
    hiddenUnread: Math.max(0, input.unread - shownUnread),
    settledUnreadIds: groups.flatMap((g) => g.rows.flatMap((r) => (r.unread ? r.ids : []))),
    badge: bellState({ open: attention, unread: input.unread }),
  };
}
