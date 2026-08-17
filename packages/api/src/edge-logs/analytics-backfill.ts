/**
 * One-shot analytics backfill: on the first boot after the rollup tables ship,
 * replay whatever full past UTC days still exist in the raw `edge_log`
 * partitions (~7 days by default) through the SAME accumulator fold the live
 * ingest uses, so the Analytics tab is non-empty on day one and its numbers
 * are byte-for-byte consistent with what live aggregation would have produced
 * (bot classification, path normalization, histograms — none of which a SQL
 * GROUP BY could reproduce).
 *
 * Today is deliberately excluded: it is owned by the live accumulator's
 * seed-then-count cycle. Past days are written insert-only (DO NOTHING), so a
 * re-run — or a race with a straggling live flush — can never clobber.
 * Backfilled visitor counts are exact: the whole day's IPs are hashed in one
 * pass and the set discarded.
 */

import { db } from "@otterdeploy/db";
import { edgeLog } from "@otterdeploy/db/schema/edge-log";
import { edgeStatDay, edgeStatMinute } from "@otterdeploy/db/schema/edge-stat";
import { Result } from "better-result";
import { and, asc, gte, lt, sql } from "drizzle-orm";
import { log } from "evlog";

import type { AnalyticsLine, DayAcc, MinuteAcc } from "./analytics-fold";

import { foldLine } from "./analytics-fold";
import { dayKey } from "./analytics-normalize";

const BATCH = 5_000;
/** Never look further back than the raw retention could plausibly hold. */
const MAX_BACKFILL_DAYS = 30;

declare global {
  var __edgeStatBackfillStarted: boolean | undefined;
}

/** Kick the backfill in the background exactly once per process. */
export function maybeBackfillAnalytics(): void {
  if (globalThis.__edgeStatBackfillStarted) return;
  globalThis.__edgeStatBackfillStarted = true;
  void runBackfill();
}

async function runBackfill(): Promise<void> {
  const res = await Result.tryPromise({
    try: () => backfillPastDays(),
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    log.error({
      edgeLog: { analytics: "backfill-failed" },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
  }
}

async function backfillPastDays(): Promise<void> {
  const today = dayKey(Date.now());

  // Trigger condition: no rollup rows for any PAST day yet. Rows for today
  // alone mean the live accumulator started before we did, not that history
  // was already backfilled.
  const existing = await db
    .select({ day: edgeStatDay.day })
    .from(edgeStatDay)
    .where(lt(edgeStatDay.day, today))
    .limit(1);
  if (existing.length > 0) return;

  // Raw bounds: the oldest surviving row decides how far back we can go.
  const oldest = await db.select({ ts: sql<string | null>`min(${edgeLog.ts})` }).from(edgeLog);
  const oldestTs = oldest[0]?.ts;
  if (!oldestTs) return;

  const startMs = Math.max(
    Date.parse(oldestTs),
    Date.now() - MAX_BACKFILL_DAYS * 24 * 60 * 60 * 1000,
  );
  let dayStartMs = Date.UTC(
    new Date(startMs).getUTCFullYear(),
    new Date(startMs).getUTCMonth(),
    new Date(startMs).getUTCDate(),
  );

  let daysDone = 0;
  let rowsRead = 0;
  while (dayKey(dayStartMs) < today) {
    const read = await backfillOneDay(dayStartMs);
    rowsRead += read;
    if (read > 0) daysDone += 1;
    dayStartMs += 24 * 60 * 60 * 1000;
  }
  log.info({ edgeLog: { analytics: "backfill-done", days: daysDone, rows: rowsRead } });
}

async function backfillOneDay(dayStartMs: number): Promise<number> {
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const maps = {
    minutes: new Map<string, MinuteAcc>(),
    days: new Map<string, DayAcc>(),
    visitorSeen: new Map<string, Set<bigint>>(),
    visitorHashCount: 0,
    // Fresh salt per run: backfilled visitor sets never have to line up with
    // the live accumulator's (different days by construction).
    salt: crypto.randomUUID(),
  };

  interface RawRow {
    id: number;
    ts: Date;
    host: string;
    path: string;
    status: number;
    latencyMs: number;
    clientIp: string;
    country: string | null;
    userAgent: string;
    referer: string;
    reqBytes: number;
    resBytes: number;
  }

  let read = 0;
  let cursor: { ts: Date; id: number } | null = null;
  for (;;) {
    // Annotated: inferring through the keyset cursor makes the type circular
    // (rows → last → cursor → rows).
    const rows: RawRow[] = await db
      .select({
        id: edgeLog.id,
        ts: edgeLog.ts,
        host: edgeLog.host,
        path: edgeLog.path,
        status: edgeLog.status,
        latencyMs: edgeLog.latencyMs,
        clientIp: edgeLog.clientIp,
        country: edgeLog.country,
        userAgent: edgeLog.userAgent,
        referer: edgeLog.referer,
        reqBytes: edgeLog.reqBytes,
        resBytes: edgeLog.resBytes,
      })
      .from(edgeLog)
      .where(
        and(
          gte(edgeLog.ts, new Date(dayStartMs)),
          lt(edgeLog.ts, new Date(dayEndMs)),
          cursor ? sql`(${edgeLog.ts}, ${edgeLog.id}) > (${cursor.ts}, ${cursor.id})` : sql`true`,
        ),
      )
      .orderBy(asc(edgeLog.ts), asc(edgeLog.id))
      .limit(BATCH);
    if (rows.length === 0) break;

    for (const row of rows) {
      const line: AnalyticsLine = {
        ts: row.ts.toISOString(),
        host: row.host,
        path: row.path,
        status: row.status,
        latencyMs: row.latencyMs,
        clientIp: row.clientIp,
        country: row.country,
        userAgent: row.userAgent,
        referer: row.referer,
        reqBytes: row.reqBytes,
        resBytes: row.resBytes,
      };
      maps.visitorHashCount = foldLine(maps, line);
    }
    read += rows.length;
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = { ts: last.ts, id: last.id };
    if (rows.length < BATCH) break;
  }

  if (read === 0) return 0;

  const minuteRows = [...maps.minutes.values()];
  for (let i = 0; i < minuteRows.length; i += 1_000) {
    await db
      .insert(edgeStatMinute)
      .values(minuteRows.slice(i, i + 1_000))
      .onConflictDoNothing();
  }
  // Insert-only for days too: a day already written (by an earlier partial
  // backfill or a live accumulator that spanned midnight) is never clobbered.
  await db
    .insert(edgeStatDay)
    .values([...maps.days.values()])
    .onConflictDoNothing();
  return read;
}
