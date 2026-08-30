/**
 * One row shape for both halves of the Blocked tab.
 *
 * "Enforcing now" and "History" used to be two tabs with two tables, two
 * column sets and two typographic scales — for what is, to an operator, one
 * question asked in two tenses: what is CrowdSec rejecting, and what did it
 * reject. They stay two READS (the live LAPI is the only authority on what is
 * being enforced this second; our recorder is the only place an expired ban
 * still exists), but they are normalised here into one row so a single table
 * can render either without branching per cell.
 */
import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

import { humanizeGoDuration } from "./duration";

type LiveDecision = InferRouterOutputs<AppRouter>["firewall"]["decisions"][number];
type RecordedDecision = InferRouterOutputs<AppRouter>["firewall"]["history"][number];

export interface BlockedRow {
  /** Stable across renders; the table's key and the expanded-row identity. */
  key: string;
  /** The blocked IP / CIDR / country code. */
  value: string;
  /** Ip | Range | Country | AS … */
  scope: string;
  /** ban | captcha | throttle … */
  type: string;
  scenario: string;
  origin: string;
  country: string | null;
  asNumber: string | null;
  asName: string | null;
  eventsCount: number | null;
  /** Humanised time left on the ban ("29d 23h"), when we know it. */
  remaining: string | null;
  /** ISO-8601 first observation, or null when the source doesn't carry one. */
  startedAt: string | null;
  /** ISO-8601 end. Null while the decision is still being enforced. */
  endedAt: string | null;
  /** Enforced right now. Drives the status dot and the Unblock affordance. */
  enforcing: boolean;
}

/**
 * The alerts read validates its input as an IP or CIDR, so asking it about a
 * country- or AS-scoped decision is a 422, not an empty answer. Only IP-shaped
 * rows offer the "why was this blocked" expansion.
 */
export function isExpandable(row: BlockedRow): boolean {
  const scope = row.scope.toLowerCase();
  return scope === "ip" || scope === "range";
}

/** Unblocking removes every decision targeting one IP; it has no meaning for
 *  a country or AS ban, which is lifted by changing the list that made it. */
export function isUnblockable(row: BlockedRow): boolean {
  return row.scope.toLowerCase() === "ip";
}

/** Live LAPI decisions → rows. Everything here is enforcing by definition. */
export function liveRows(decisions: readonly LiveDecision[]): BlockedRow[] {
  return decisions.map((d, i) => ({
    key: `live:${d.id ?? i}:${d.value}`,
    value: d.value,
    scope: d.scope,
    type: d.type,
    scenario: d.scenario,
    origin: d.origin,
    country: d.country,
    asNumber: d.asNumber,
    asName: d.asName,
    eventsCount: d.eventsCount,
    remaining: humanizeGoDuration(d.duration),
    startedAt: d.createdAt,
    endedAt: null,
    enforcing: true,
  }));
}

/** Recorded decisions → rows. `endedAt === null` is what "still enforcing"
 *  means in our own table, so it is the only thing that decides the status. */
export function recordedRows(rows: readonly RecordedDecision[]): BlockedRow[] {
  return rows.map((r) => ({
    key: `rec:${r.id}`,
    value: r.value,
    scope: r.scope,
    type: r.type,
    scenario: r.scenario,
    origin: r.origin,
    country: r.country,
    asNumber: r.asNumber,
    asName: r.asName,
    eventsCount: r.eventsCount,
    remaining: r.duration === null ? null : humanizeGoDuration(r.duration),
    startedAt: r.firstSeenAt,
    endedAt: r.endedAt,
    enforcing: r.endedAt === null,
  }));
}

/** Everything the search box matches a Blocked row on. */
export function blockedFields(row: BlockedRow): ReadonlyArray<string | number | null | undefined> {
  return [
    row.value,
    row.country,
    row.asNumber === null ? null : `AS${row.asNumber}`,
    row.asName,
    row.scenario,
    row.origin,
    row.type,
    row.scope,
    row.enforcing ? "enforcing" : "expired",
  ];
}
