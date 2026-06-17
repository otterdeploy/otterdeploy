/**
 * In-memory store for the operational log plane (Phase 3): a bounded ring
 * buffer plus a live pub/sub, mirroring ring.ts. Far lower volume than access
 * logs, so a smaller cap. v1 is live-tail-only (no DB table) — persistence is
 * deferred (see docs/designs/edge-logs.md §7.3). Module singleton on
 * globalThis for the same `--hot`-reload reason as the access ring.
 */

import { RANGE_MS } from "./ring";
import type {
  EdgeEventFilter,
  EdgeEventLine,
  EdgeEventQueryResult,
} from "./types";

/** Operational events are sparse vs. access logs — a small ring is plenty. */
const MAX_EVENTS = 5_000;

type Subscriber = (line: EdgeEventLine) => void;

const state = ((globalThis as typeof globalThis & {
  __edgeEventRing?: { buffer: EdgeEventLine[]; subscribers: Set<Subscriber> };
}).__edgeEventRing ??= { buffer: [], subscribers: new Set<Subscriber>() });

export function pushEdgeEvent(line: EdgeEventLine): void {
  state.buffer.push(line);
  if (state.buffer.length > MAX_EVENTS) state.buffer.shift();
  for (const fn of state.subscribers) fn(line);
}

/** Subscribe to live events. Returns an unsubscribe fn. */
export function subscribeEdgeEvents(fn: Subscriber): () => void {
  state.subscribers.add(fn);
  return () => state.subscribers.delete(fn);
}

/** Hosts an event is attributable to — the single `host` plus any batch
 *  `domains`. An event is visible to a caller iff one of these is in scope. */
export function eventHosts(line: EdgeEventLine): string[] {
  return line.host ? [line.host, ...line.domains] : line.domains;
}

/** True when the event touches at least one of the caller's hosts. Events with
 *  no attributable host at all (config reloads, server lifecycle) are NOT
 *  surfaced in the org/project-scoped UI — they'd leak nothing, but they're
 *  also not actionable per-tenant; an operator surface is future work. */
function inScope(line: EdgeEventLine, hosts: string[]): boolean {
  const owned = new Set(hosts);
  return eventHosts(line).some((h) => owned.has(h));
}

function matchesSearch(line: EdgeEventLine, q: string): boolean {
  const hay =
    `${line.msg} ${line.host ?? ""} ${line.upstream ?? ""} ${line.error ?? ""} ${line.logger}`.toLowerCase();
  return hay.includes(q);
}

function matches(line: EdgeEventLine, f: EdgeEventFilter, sinceMs: number): boolean {
  if (Date.parse(line.ts) < sinceMs) return false;
  if (!inScope(line, f.hosts)) return false;
  const sel = f.selectedHosts;
  if (sel?.length && !eventHosts(line).some((h) => sel.includes(h))) return false;
  if (f.categories?.length && !f.categories.includes(line.category)) return false;
  if (f.levels?.length && !f.levels.includes(line.level)) return false;
  if (f.search && !matchesSearch(line, f.search.toLowerCase())) return false;
  return true;
}

/** Redact a batch event's `domains` to the caller's owned subset, so the
 *  cert-management line for the whole box only shows this tenant's domains. */
function redact(line: EdgeEventLine, hosts: string[]): EdgeEventLine {
  if (line.domains.length === 0) return line;
  const owned = new Set(hosts);
  const domains = line.domains.filter((d) => owned.has(d));
  return domains.length === line.domains.length ? line : { ...line, domains };
}

export function queryEdgeEvents(
  filter: EdgeEventFilter,
  now: number,
): EdgeEventQueryResult {
  const sinceMs = now - RANGE_MS[filter.range];
  const matched = state.buffer.filter((l) => matches(l, filter, sinceMs));
  const limit = filter.limit ?? 200;
  const rows = matched.slice(-limit).reverse().map((l) => redact(l, filter.hosts));
  return { rows, total: matched.length };
}

/** Test seam — drain the buffer between tests. */
export function __resetEdgeEvents(): void {
  state.buffer.length = 0;
  state.subscribers.clear();
}
