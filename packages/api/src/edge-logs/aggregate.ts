/**
 * Ingest-time analytics accumulator: the live state machine over the pure
 * fold in ./analytics-fold, flushed to `edge_stat_minute` / `edge_stat_day`
 * on timers (DB half in ./aggregate-flush). This is what lets the Analytics
 * surface answer 90-day windows with exact counts while the raw `edge_log`
 * partitions behind it are dropped on a 7-day retention.
 *
 * Deliberately INDEPENDENT of the edge-log persistence toggle, like the
 * threat rollup: rollups are the durable value; a tail-only install still
 * accumulates analytics.
 *
 * Write semantics (the load-bearing design, mirrored in the schema docs):
 * - Minute rows are CLOSED-MINUTE DELTAS, inserted once with ON CONFLICT DO
 *   NOTHING. Idempotent across restarts and backfill overlap.
 * - Day rows are RUNNING TOTALS, upserted full-set (last-write-wins). Safe
 *   because exactly ONE in-process accumulator owns a day at a time. If the
 *   log sink ever fans out to multiple processes, the day flush MUST become a
 *   delta-add upsert (`SET x = edge_stat_day.x + excluded.x`) and minute rows
 *   need per-writer keys; do not scale the sink out without changing this.
 *
 * Restart story: on start, today's (and, just after midnight UTC,
 * yesterday's) day rows are re-seeded from the DB before flushes are enabled,
 * so the full-set upsert can never clobber earlier totals with a
 * freshly-zeroed accumulator. Seeded days are marked `approximate`: the
 * visitor hash set cannot be reconstructed, so returning visitors may be
 * double-counted from that point on. Crash loss is bounded: an open minute
 * (≤ ~65s) of series data, ≤30s of day-total deltas.
 */

import { Result } from "better-result";
import { log } from "evlog";

import type { AnalyticsLine, DayAcc, FoldMaps, MinuteAcc } from "./analytics-fold";

import {
  flushDayRows,
  flushMinuteRows,
  pruneAnalyticsRollups,
  seedDayRows,
} from "./aggregate-flush";
import { foldLine } from "./analytics-fold";
import { dayKey } from "./analytics-normalize";

export type { AnalyticsLine, DayAcc, MinuteAcc } from "./analytics-fold";
export { foldLine, OVERFLOW_KEY, PATHS_PER_DAY_CAP, VISITOR_HASH_CAP } from "./analytics-fold";

const FLUSH_INTERVAL_MS = 5_000;
/** Day rows flush every Nth minute-flush tick (5s × 6 = 30s). */
const DAY_FLUSH_EVERY_TICKS = 6;
/** Grace after a minute closes before its row is written: late lines from
 *  Caddy's buffered net output still land in the right bucket. */
const MINUTE_CLOSE_GRACE_MS = 5_000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface AggState extends FoldMaps {
  enabled: boolean;
  tick: number;
  flushTimer: ReturnType<typeof setInterval> | null;
  pruneTimer: ReturnType<typeof setInterval> | null;
}

// Same reason as the ring / persist queue / threat rollup: the sink's captured
// closure and freshly re-imported modules must share ONE state across `--hot`
// reloads, or lines accumulate in maps nobody ever flushes. Declared rather
// than cast, which the assertion ban forbids.
declare global {
  var __edgeStatAgg: AggState | undefined;
}

const state: AggState = (globalThis.__edgeStatAgg ??= {
  minutes: new Map(),
  days: new Map(),
  visitorSeen: new Map(),
  visitorHashCount: 0,
  salt: crypto.randomUUID(),
  enabled: false,
  tick: 0,
  flushTimer: null,
  pruneTimer: null,
});

/**
 * Fold one parsed access-log line into the rollups. No-op until
 * {@link startEdgeAnalytics}. Never throws: ingest runs on the socket's data
 * handler.
 */
export function recordAnalytics(line: AnalyticsLine): void {
  if (!state.enabled) return;
  try {
    state.visitorHashCount = foldLine(state, line);
  } catch (error) {
    log.error({
      edgeLog: { analytics: "record-failed" },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Live, unflushed accumulators, for the read path's freshness merge. The
 *  returned accs are the live objects: readers must not mutate them. */
export function snapshotAccumulators(): { minutes: MinuteAcc[]; days: DayAcc[] } {
  return { minutes: [...state.minutes.values()], days: [...state.days.values()] };
}

/** Minute accs whose minute has closed (plus grace) are ready to persist. */
function takeClosedMinutes(nowMs: number): MinuteAcc[] {
  const closed: MinuteAcc[] = [];
  for (const [key, acc] of state.minutes) {
    if (nowMs >= (acc.minute + 1) * 60_000 + MINUTE_CLOSE_GRACE_MS) {
      closed.push(acc);
      state.minutes.delete(key);
    }
  }
  return closed;
}

/** After a successful day flush, accs for days that can no longer receive
 *  traffic are final in the DB: drop them and release their visitor sets. */
function dropSettledDays(): void {
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - DAY_MS);
  for (const [key, acc] of state.days) {
    if (acc.day !== today && acc.day !== yesterday) {
      state.days.delete(key);
      const seen = state.visitorSeen.get(key);
      if (seen) {
        state.visitorHashCount -= seen.size;
        state.visitorSeen.delete(key);
      }
    }
  }
}

async function flushTick(): Promise<void> {
  state.tick += 1;
  await flushMinuteRows(takeClosedMinutes(Date.now()));
  if (state.tick % DAY_FLUSH_EVERY_TICKS === 0) {
    if (await flushDayRows([...state.days.values()])) dropSettledDays();
  }
}

/**
 * Re-seed the current day's accumulators from the DB so the full-set upsert
 * can never clobber a day's earlier totals with a freshly-zeroed acc. Just
 * after midnight UTC, yesterday is seeded too: straggler lines can still
 * arrive through Caddy's buffered output and the minute-close grace.
 */
async function seedCurrentDays(): Promise<void> {
  const now = Date.now();
  const days = [dayKey(now)];
  if (now % DAY_MS < 10 * 60 * 1000) days.push(dayKey(now - DAY_MS));
  for (const acc of await seedDayRows(days)) {
    const key = `${acc.host}|${acc.day}`;
    if (!state.days.has(key)) state.days.set(key, acc);
  }
}

export async function startEdgeAnalytics(): Promise<void> {
  if (state.flushTimer) clearInterval(state.flushTimer);
  if (state.pruneTimer) clearInterval(state.pruneTimer);
  // Seed BEFORE enabling: a line folded into an unseeded day acc would race
  // the seed's has-key check and the day would start from that line alone.
  const seeded = await Result.tryPromise({
    try: () => seedCurrentDays(),
    catch: (cause) => cause,
  });
  if (seeded.isErr()) {
    // Missing seed means the first day flush could clobber earlier totals, so
    // refuse to run rather than silently corrupt: the next boot retries.
    log.error({
      edgeLog: { analytics: "seed-failed" },
      error: seeded.error instanceof Error ? seeded.error.message : String(seeded.error),
    });
    return;
  }
  state.enabled = true;
  state.flushTimer = setInterval(() => void flushTick(), FLUSH_INTERVAL_MS);
  state.pruneTimer = setInterval(() => void pruneAnalyticsRollups(), PRUNE_INTERVAL_MS);
  void pruneAnalyticsRollups();
  log.info({ edgeLog: { analytics: "started", seededDays: state.days.size } });
}

/**
 * Is the rollup loop live right now?
 *
 * Distinct from "is EDGE_LOG_SINK configured". `startEdgeAnalytics` refuses to
 * enable when its day-row seed fails, precisely so a flush cannot clobber
 * earlier totals, and that refusal is silent to anyone reading the Analytics
 * page. Surfacing it lets the page say "configured but not running" instead of
 * blaming an empty window.
 */
export function analyticsRunning(): boolean {
  return state.enabled;
}

export async function stopEdgeAnalytics(): Promise<void> {
  state.enabled = false;
  if (state.flushTimer) clearInterval(state.flushTimer);
  if (state.pruneTimer) clearInterval(state.pruneTimer);
  state.flushTimer = null;
  state.pruneTimer = null;
  // Closed minutes + day totals persist; the open minute's series data is
  // deliberately dropped (its traffic is already in the day totals, and a
  // partial minute row would block the post-restart half via DO NOTHING).
  await flushMinuteRows(takeClosedMinutes(Date.now()));
  await flushDayRows([...state.days.values()]);
}

/** Test seam: reset all buffered state between tests. */
export function __resetEdgeStatAgg(): void {
  state.minutes.clear();
  state.days.clear();
  state.visitorSeen.clear();
  state.visitorHashCount = 0;
  state.enabled = false;
  state.tick = 0;
}
