/**
 * Batched persistence for the analytics plane (docs/designs/web-analytics.md
 * §4.5). Mirrors edge-logs/persist.ts: state on `globalThis` (a `--hot`
 * reload keeps the buffer), a 1 s flush loop, an hourly sweep (partitions
 * ahead, retention behind, idle sessions out of memory).
 *
 * "Live right now" has no separate store: every signal bumps its session's
 * `last_at` through the sessionizer and this flush loop lands it within
 * ~1 s, so the query plane reads liveness straight off `analytics_session`.
 */

import type { NewAnalyticsEventRow } from "@otterdeploy/db/schema/analytics-event";
import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import { log } from "evlog";

import type { PendingDefinition } from "./writer-flush";

import { analyticsRetentionDays } from "../lib/platform-runtime-settings";
import {
  dropOldAnalyticsPartitions,
  ensureAnalyticsEventTable,
  ensureAnalyticsPartitions,
} from "./partition";
import { sweepIdleSessions, takeDirtySessions } from "./sessionizer";
import {
  pruneExpiredSessions,
  writeDefinitions,
  writeEvents,
  writeFirstEvents,
  writeSessions,
} from "./writer-flush";

export { collectStats } from "./stats";

const FLUSH_INTERVAL_MS = 1_000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1_000;
const MAX_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1_000;

interface IngestState {
  enabled: boolean;
  /** True once the partitioned table exists; flush no-ops until then. */
  ready: boolean;
  events: NewAnalyticsEventRow[];
  /** Keyed `${siteId}|${name}` so one flush upserts each name once. */
  definitions: Map<string, PendingDefinition>;
  firstEvents: Map<AnalyticsSiteId, number>;
  /** Sites whose first_event_at this process already stamped. */
  firstEventDone: Set<AnalyticsSiteId>;
  flushTimer: ReturnType<typeof setInterval> | null;
  sweepTimer: ReturnType<typeof setInterval> | null;
  inflight: Promise<void> | null;
}

declare global {
  var __analyticsIngest: IngestState | undefined;
}

const state: IngestState = (globalThis.__analyticsIngest ??= {
  enabled: false,
  ready: false,
  events: [],
  definitions: new Map(),
  firstEvents: new Map(),
  firstEventDone: new Set(),
  flushTimer: null,
  sweepTimer: null,
  inflight: null,
});

/** Idempotent across hot reloads: clears prior timers and (re)starts. */
export function startAnalyticsIngest(): void {
  if (state.flushTimer) clearInterval(state.flushTimer);
  if (state.sweepTimer) clearInterval(state.sweepTimer);
  state.enabled = true;
  state.ready = false;
  // ensure* log (never throw) on failure, so `ready` still flips and we
  // degrade to logged flush errors rather than a wedged buffer.
  void (async () => {
    await ensureAnalyticsEventTable();
    state.ready = true;
    await flush();
  })();
  state.flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  state.sweepTimer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  log.info({ analytics: { ingest: "started" } });
}

export async function stopAnalyticsIngest(): Promise<void> {
  state.enabled = false;
  if (state.flushTimer) clearInterval(state.flushTimer);
  if (state.sweepTimer) clearInterval(state.sweepTimer);
  state.flushTimer = null;
  state.sweepTimer = null;
  // Twice: once to join any in-flight flush, once for what arrived meanwhile.
  await flush();
  await flush();
}

export function analyticsIngestEnabled(): boolean {
  return state.enabled;
}

/** Queue a raw event row. No-op until startAnalyticsIngest(). */
export function enqueueEvent(row: NewAnalyticsEventRow): void {
  if (!state.enabled) return;
  state.events.push(row);
  if (state.events.length >= MAX_BATCH) void flush();
}

/** Note a custom event name for the definitions catalogue. */
export function noteEventDefinition(siteId: AnalyticsSiteId, name: string, at: number): void {
  if (!state.enabled) return;
  const key = `${siteId}|${name}`;
  const prev = state.definitions.get(key);
  if (prev) prev.at = Math.max(prev.at, at);
  else state.definitions.set(key, { siteId, name, at });
}

/** Note that a site (whose cached row had `firstEventAt: null`) got data. */
export function noteFirstEvent(siteId: AnalyticsSiteId, at: number): void {
  if (!state.enabled || state.firstEventDone.has(siteId)) return;
  const prev = state.firstEvents.get(siteId);
  if (prev === undefined || at < prev) state.firstEvents.set(siteId, at);
}

function flush(): Promise<void> {
  state.inflight ??= doFlush().finally(() => {
    state.inflight = null;
  });
  return state.inflight;
}

async function doFlush(): Promise<void> {
  if (!state.ready) return;
  const events = state.events.splice(0, state.events.length);
  const sessions = takeDirtySessions();
  const definitions = [...state.definitions.values()];
  state.definitions.clear();
  const firsts = new Map(state.firstEvents);
  state.firstEvents.clear();
  for (const siteId of firsts.keys()) state.firstEventDone.add(siteId);

  if (events.length > 0) await writeEvents(events);
  if (sessions.length > 0) await writeSessions(sessions);
  await writeDefinitions(definitions);
  await writeFirstEvents(firsts);
}

async function sweep(): Promise<void> {
  await ensureAnalyticsPartitions();
  const retention = await Result.tryPromise({
    try: () => analyticsRetentionDays(),
    catch: (cause) => cause,
  });
  if (retention.isErr()) {
    log.error({
      analytics: { ingest: "sweep-retention-failed" },
      error: retention.error instanceof Error ? retention.error.message : String(retention.error),
    });
    return;
  }
  await dropOldAnalyticsPartitions(retention.value);
  await pruneExpiredSessions(Date.now() - retention.value * DAY_MS);
  // Flush before forgetting, so a dirty-but-idle session is never lost.
  await flush();
  sweepIdleSessions(Date.now());
}
