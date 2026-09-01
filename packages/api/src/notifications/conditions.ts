/**
 * Turning inbox rows into what still needs attention.
 *
 * The `notification` table stores OCCURRENCES: one row every time something
 * was worth saying. An operator does not think in occurrences. "Memory is
 * nearly exhausted" said twenty times is one problem, and a deploy that
 * failed and then succeeded is no problem at all. This module folds rows into
 * CONDITIONS: keyed by (event family, subject), opened by a failure or a
 * pressure warning, resolved by the matching success or clear event.
 *
 * Pure and synchronous on purpose: it takes the rows the query already
 * fetched and returns the open conditions plus which rows they consumed, so
 * the inbox handler can hand the client "needs attention" and "everything
 * else" as two lists that never overlap. Everything here is unit-tested
 * against the shapes the emitters actually write.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { decodeSubject, type InboxSubject } from "@otterdeploy/shared/inbox-subject";

export interface ConditionSourceRow<Id extends string = string> {
  id: Id;
  title: string;
  message: string;
  data: JsonObject | null;
  readAt: Date | null;
  createdAt: Date;
}

/** A reclaim the server page can run; the only action the inbox mutates through today. */
export interface ConditionAction {
  kind: "reclaim";
  target: "images" | "build-cache" | "branch-pool";
}

export interface OpenCondition<Id extends string = string> {
  /** Stable across occurrences: what "the same problem" means. */
  key: string;
  eventId: string;
  severity: "warn" | "err";
  title: string;
  message: string;
  subject: InboxSubject | null;
  /** Occurrences folded into this condition, newest first. */
  occurrenceIds: Id[];
  count: number;
  firstAt: Date;
  lastAt: Date;
  unread: boolean;
  /** How many of the occurrences are unread; the badge math needs the number. */
  unreadCount: number;
  action: ConditionAction | null;
  /** The newest occurrence's payload, for deep links (deploymentId, …). */
  data: JsonObject;
}

/**
 * A pressure condition with no clear event in this long is stale, not open:
 * rows from before the monitor emitted transitions have no clear to wait for,
 * and a monitor that died mid-condition must not pin a card forever.
 */
const PRESSURE_STALE_MS = 24 * 60 * 60 * 1000;

const RECLAIM_TARGETS = ["images", "build-cache", "branch-pool"] as const;

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function eventIdOf(row: ConditionSourceRow): string | null {
  return str(row.data?.eventId);
}

/** `family:id`, or null when there is no id to key on. */
function keyed(family: string, id: string | null): string | null {
  return id === null ? null : `${family}:${id}`;
}

/**
 * The condition a row belongs to, or null for rows that are records rather
 * than states (a rotation, a probe, an orphaned schedule).
 *
 * Subject id first; the legacy display strings second, so rows written
 * before subjects existed still fold with each other, just not across the
 * boundary — a `web` that failed yesterday under the old shape and succeeded
 * today under the new one are two keys, which errs on the side of showing
 * the failure rather than hiding it.
 */
export function conditionKey(eventId: string, data: JsonObject | null): string | null {
  // Records about a schedule, not a source: nothing later "resolves" them.
  if (eventId === "backup.overdue" || eventId === "backup.orphaned") return null;
  const build = FAMILY_KEY[eventId.split(".")[0] ?? ""];
  return build ? build(decodeSubject(data)?.id ?? null, data) : null;
}

type KeyBuilder = (subjectId: string | null, data: JsonObject | null) => string | null;

const resourceKey =
  (family: string): KeyBuilder =>
  (subjectId, data) =>
    keyed(family, subjectId ?? str(data?.resource));

const FAMILY_KEY: Record<string, KeyBuilder> = {
  // Instance-wide by construction (the monitor watches the host it runs on),
  // so the subject is deliberately NOT part of the key: rows from before the
  // emitter wrote one fold with rows from after, instead of the same warning
  // showing twice across an upgrade.
  host: (_subjectId, data) => keyed("pressure", str(data?.recommendation)),
  deploy: resourceKey("deploy"),
  build: resourceKey("deploy"),
  health: resourceKey("health"),
  backup: (subjectId, data) =>
    keyed("backup", subjectId ?? str(data?.resourceId) ?? str(data?.volume)),
};

/** Severity of pressure as the emitter graded it; null for info-level records. */
function pressureGrade(data: JsonObject | null): "warn" | "err" | null {
  // The catalog id alone says "warn" for a box at 100% memory, which is the
  // wrong colour; the payload carries the real grade.
  const graded = str(data?.severity);
  if (graded === "critical") return "err";
  if (graded === "warning") return "warn";
  return null;
}

const OPENERS: Record<string, "warn" | "err"> = {
  "deploy.failed": "err",
  "deploy.crashed": "err",
  "build.failed": "err",
  "backup.failed": "err",
  "backup.verify-failed": "err",
  "health.degraded": "warn",
};

/** Severity an OPENING row carries, or null when the row does not open anything. */
function openingSeverity(eventId: string, data: JsonObject | null): "warn" | "err" | null {
  if (eventId === "host.pressure") return pressureGrade(data);
  return OPENERS[eventId] ?? null;
}

function actionOf(eventId: string, data: JsonObject | null): ConditionAction | null {
  if (eventId !== "host.pressure") return null;
  const target = RECLAIM_TARGETS.find((t) => t === str(data?.action));
  return target === undefined ? null : { kind: "reclaim", target };
}

function bucketByKey<Id extends string>(
  rows: readonly ConditionSourceRow<Id>[],
): Map<string, ConditionSourceRow<Id>[]> {
  const byKey = new Map<string, ConditionSourceRow<Id>[]>();
  for (const row of rows) {
    const eventId = eventIdOf(row);
    const key = eventId === null ? null : conditionKey(eventId, row.data);
    if (key === null) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }
  return byKey;
}

/**
 * The open condition one key's rows describe, or null when its newest row
 * is a resolver, an unrelated row (`deploy.started`), or a stale warning.
 *
 * The NEWEST row decides. When it opens, every consecutive older opener is
 * an occurrence of the same condition, up to the last resolver/other row.
 */
function openConditionFor<Id extends string>(
  key: string,
  bucket: ConditionSourceRow<Id>[],
  now: Date,
): OpenCondition<Id> | null {
  bucket.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const newest = bucket[0];
  if (!newest) return null;
  const newestEvent = eventIdOf(newest) ?? "";
  const severity = openingSeverity(newestEvent, newest.data);
  if (severity === null) return null;
  if (
    key.startsWith("pressure:") &&
    now.getTime() - newest.createdAt.getTime() > PRESSURE_STALE_MS
  ) {
    return null;
  }

  const occurrences: ConditionSourceRow<Id>[] = [];
  for (const row of bucket) {
    if (openingSeverity(eventIdOf(row) ?? "", row.data) === null) break;
    occurrences.push(row);
  }
  const oldest = occurrences[occurrences.length - 1] ?? newest;

  // Worst grade across the run: a condition that was critical an hour ago
  // and is warning now is still reported at its worst, so a flapping box
  // cannot talk itself down to amber.
  const worst = occurrences.some((row) => openingSeverity(eventIdOf(row) ?? "", row.data) === "err")
    ? "err"
    : severity;

  return {
    key,
    eventId: newestEvent,
    severity: worst,
    title: newest.title,
    message: newest.message,
    // From the newest occurrence that carries one: rows written before the
    // emitter learned subjects fold with rows written after, and the card
    // must still know where to link.
    subject: occurrences.map((row) => decodeSubject(row.data)).find((s) => s !== null) ?? null,
    occurrenceIds: occurrences.map((row) => row.id),
    count: occurrences.length,
    firstAt: oldest.createdAt,
    lastAt: newest.createdAt,
    unread: occurrences.some((row) => row.readAt === null),
    unreadCount: occurrences.filter((row) => row.readAt === null).length,
    action: actionOf(newestEvent, newest.data),
    data: newest.data ?? {},
  };
}

const RANK: Record<"err" | "warn", number> = { err: 0, warn: 1 };

/**
 * Fold rows (newest first) into open conditions, worst first then most
 * recent. Rows a condition consumed must not be listed again as history, so
 * the consumed ids are returned alongside.
 */
export function deriveOpenConditions<Id extends string>(
  rows: readonly ConditionSourceRow<Id>[],
  now: Date = new Date(),
): { open: OpenCondition<Id>[]; consumed: Set<Id> } {
  const open: OpenCondition<Id>[] = [];
  const consumed = new Set<Id>();
  for (const [key, bucket] of bucketByKey(rows)) {
    const condition = openConditionFor(key, bucket, now);
    if (condition === null) continue;
    open.push(condition);
    for (const id of condition.occurrenceIds) consumed.add(id);
  }
  open.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || b.lastAt.getTime() - a.lastAt.getTime(),
  );
  return { open, consumed };
}
