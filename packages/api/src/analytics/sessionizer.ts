/**
 * In-process sessionization (docs/designs/web-analytics.md §4.4).
 *
 * Key `(site, visitor, sidHash)`: one visit per tab per visitor-day. A
 * session ends after 30 min without a signal or 24 h after it started. On a
 * memory miss the most recent open session for `(site, visitor)` is read
 * back from the DB before a new one is created, so a collector restart
 * continues visits instead of splitting them. First-touch fields (entry
 * path, referrer, UTM, device…) are frozen on creation; pageviews, events,
 * engagement and exit path accumulate. The writer drains `dirty` sessions
 * every second and upserts them monotonically.
 *
 * State lives on `globalThis` so a `--hot` reload keeps open sessions.
 * `now` and the DB lookup are injectable for tests.
 */

import type { NewAnalyticsSessionRow } from "@otterdeploy/db/schema/analytics";
import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { createHash } from "node:crypto";

import type { LookupOpenSession, OpenSession, SessionDimensions } from "./session-store";

import {
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  lookupOpenSessionDb,
  toSessionRow,
} from "./session-store";

export { SESSION_IDLE_MS, SESSION_MAX_MS } from "./session-store";
export type { OpenSession, SessionDimensions } from "./session-store";

/** Hard cap on open sessions held in memory; past it the stalest
 *  already-persisted entries are evicted (they are re-read from the DB on
 *  their next signal, exactly like after a restart). */
const MAX_OPEN_SESSIONS = 100_000;

declare global {
  var __analyticsSessions: Map<string, OpenSession> | undefined;
}

function store(): Map<string, OpenSession> {
  globalThis.__analyticsSessions ??= new Map();
  return globalThis.__analyticsSessions;
}

export interface SessionKey {
  siteId: AnalyticsSiteId;
  visitorId: string;
  sidHash: string;
}

export interface SessionSignal {
  kind: "pv" | "ev" | "eng" | "hb";
  at: number;
  path: string;
  dims: SessionDimensions;
  /** `eng` only. */
  activeMs?: number;
  scroll?: number;
}

export interface ApplySignalOptions {
  lookupOpenSession?: LookupOpenSession;
}

/** First 16 hex of sha256(site|sid): the per-tab id never touches storage. */
export function sidHashOf(siteId: AnalyticsSiteId, sid: string): string {
  return createHash("sha256").update(`${siteId}|${sid}`).digest("hex").slice(0, 16);
}

function mapKey(key: SessionKey): string {
  return `${key.siteId}|${key.visitorId}|${key.sidHash}`;
}

export function isExpired(session: OpenSession, at: number): boolean {
  return at - session.lastAt > SESSION_IDLE_MS || at - session.startedAt > SESSION_MAX_MS;
}

function create(key: SessionKey, signal: SessionSignal): OpenSession {
  return {
    ...signal.dims,
    id: createId(ID_PREFIX.analyticsSession),
    siteId: key.siteId,
    visitorId: key.visitorId,
    externalUserId: null,
    startedAt: signal.at,
    lastAt: signal.at,
    pageviews: 0,
    events: 0,
    activeMs: 0,
    scroll: null,
    entryPath: signal.path,
    exitPath: signal.path,
    dirty: true,
  };
}

function evictIfFull(): void {
  const all = store();
  if (all.size < MAX_OPEN_SESSIONS) return;
  const candidates = [...all.entries()]
    .filter(([, s]) => !s.dirty)
    .sort((a, b) => a[1].lastAt - b[1].lastAt);
  for (const [k] of candidates.slice(0, Math.ceil(MAX_OPEN_SESSIONS / 10))) all.delete(k);
}

function fold(session: OpenSession, signal: SessionSignal): void {
  switch (signal.kind) {
    case "pv":
      session.pageviews += 1;
      session.exitPath = signal.path;
      break;
    case "ev":
      session.events += 1;
      break;
    case "eng":
      session.activeMs = Math.min(SESSION_MAX_MS, session.activeMs + (signal.activeMs ?? 0));
      if (signal.scroll !== undefined) {
        session.scroll = Math.max(session.scroll ?? 0, signal.scroll);
      }
      break;
    case "hb":
      break;
  }
  session.lastAt = Math.max(session.lastAt, signal.at);
  session.dirty = true;
}

/**
 * Fold one signal into the visitor's open session, creating (or resuming
 * from the DB) one when none is open. Returns the session the signal landed
 * in, so the caller can stamp its id on the event row.
 */
export async function applySignal(
  key: SessionKey,
  signal: SessionSignal,
  options: ApplySignalOptions = {},
): Promise<OpenSession> {
  const all = store();
  const k = mapKey(key);
  let session = all.get(k);
  if (session && isExpired(session, signal.at)) {
    all.delete(k);
    session = undefined;
  }
  if (!session) {
    const lookup = options.lookupOpenSession ?? lookupOpenSessionDb;
    const resumed = await lookup(key.siteId, key.visitorId, signal.at);
    session = resumed && !isExpired(resumed, signal.at) ? resumed : create(key, signal);
    evictIfFull();
    all.set(k, session);
  }
  fold(session, signal);
  return session;
}

/** `identify(id)`: attach a hashed external user id to the open session.
 *  False when there is no open session for the key (nothing to attach to). */
export function identifySession(key: SessionKey, externalUserId: string, at: number): boolean {
  const session = store().get(mapKey(key));
  if (!session || isExpired(session, at)) return false;
  session.externalUserId = externalUserId;
  session.lastAt = Math.max(session.lastAt, at);
  session.dirty = true;
  return true;
}

/** Snapshot every changed session as a row for the writer and clear the
 *  flags. Rows, not live objects, so a flush that races with new signals
 *  never sees half-applied state. */
export function takeDirtySessions(): NewAnalyticsSessionRow[] {
  const rows: NewAnalyticsSessionRow[] = [];
  for (const session of store().values()) {
    if (!session.dirty) continue;
    session.dirty = false;
    rows.push(toSessionRow(session));
  }
  return rows;
}

/** Forget sessions idle past the window. They are already persisted (dirty
 *  ones are kept for the next flush), so this only bounds memory. */
export function sweepIdleSessions(now: number): number {
  let dropped = 0;
  for (const [k, session] of store()) {
    if (session.dirty || !isExpired(session, now)) continue;
    store().delete(k);
    dropped++;
  }
  return dropped;
}

export function openSessionCount(): number {
  return store().size;
}

/** Test / hot-reload helper. */
export function resetSessionizer(): void {
  store().clear();
}
