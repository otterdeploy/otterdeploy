/**
 * The writer's SQL: batched inserts/upserts for the analytics plane. Every
 * statement is wrapped in `Result.tryPromise` and logs ONLY on failure, with
 * counts, never per event (namespace `analytics: { ingest: … }`). The
 * session upsert is monotonic (`GREATEST`, `COALESCE`) so a second writer
 * could only lose counter updates, never corrupt a row (design §4).
 */

import type { NewAnalyticsSessionRow } from "@otterdeploy/db/schema/analytics";
import type { NewAnalyticsEventRow } from "@otterdeploy/db/schema/analytics-event";
import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  analyticsEventDefinition,
  analyticsSession,
  analyticsSite,
} from "@otterdeploy/db/schema/analytics";
import { analyticsEvent } from "@otterdeploy/db/schema/analytics-event";
import { Result } from "better-result";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { log } from "evlog";

const BATCH = 500;
const PRUNE_CHUNK = 5_000;
/** Bound one sweep's prune loop; the next hourly sweep continues. */
const PRUNE_MAX_CHUNKS = 100;

/** Run one statement; on failure log it (with the batch size, never per
 *  row) and yield null so the caller moves on to the next chunk. */
async function attempt<T>(step: string, count: number, run: () => Promise<T>): Promise<T | null> {
  const res = await Result.tryPromise({ try: run, catch: (cause) => cause });
  if (res.isOk()) return res.value;
  log.error({
    analytics: { ingest: step, count },
    error: res.error instanceof Error ? res.error.message : String(res.error),
  });
  return null;
}

/** Raw event rows; `ON CONFLICT DO NOTHING` on (id, ts) dedupes a retried
 *  tracker batch. */
export async function writeEvents(rows: readonly NewAnalyticsEventRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await attempt("events-flush-failed", chunk.length, () =>
      db.insert(analyticsEvent).values(chunk).onConflictDoNothing(),
    );
  }
}

export async function writeSessions(rows: readonly NewAnalyticsSessionRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await attempt("sessions-flush-failed", chunk.length, () =>
      db
        .insert(analyticsSession)
        .values(chunk)
        .onConflictDoUpdate({
          target: analyticsSession.id,
          set: {
            lastAt: sql`GREATEST(${analyticsSession.lastAt}, excluded.last_at)`,
            pageviews: sql`excluded.pageviews`,
            events: sql`excluded.events`,
            activeMs: sql`excluded.active_ms`,
            scroll: sql`GREATEST(${analyticsSession.scroll}, excluded.scroll)`,
            exitPath: sql`excluded.exit_path`,
            externalUserId: sql`COALESCE(excluded.external_user_id, ${analyticsSession.externalUserId})`,
          },
        }),
    );
  }
}

export interface PendingDefinition {
  siteId: AnalyticsSiteId;
  name: string;
  /** Epoch ms of the latest sighting in the flush window. */
  at: number;
}

/** Auto-register custom event names; a replay only ratchets `last_seen_at`. */
export async function writeDefinitions(defs: readonly PendingDefinition[]): Promise<void> {
  if (defs.length === 0) return;
  await attempt("definitions-flush-failed", defs.length, () =>
    db
      .insert(analyticsEventDefinition)
      .values(
        defs.map((d) => ({
          siteId: d.siteId,
          name: d.name,
          firstSeenAt: new Date(d.at),
          lastSeenAt: new Date(d.at),
        })),
      )
      .onConflictDoUpdate({
        target: [analyticsEventDefinition.siteId, analyticsEventDefinition.name],
        set: {
          lastSeenAt: sql`GREATEST(${analyticsEventDefinition.lastSeenAt}, excluded.last_seen_at)`,
        },
      }),
  );
}

/** Stamp `first_event_at` once per site ("snippet verified" checklist). */
export async function writeFirstEvents(
  firsts: ReadonlyMap<AnalyticsSiteId, number>,
): Promise<void> {
  for (const [siteId, at] of firsts) {
    await attempt("first-event-flush-failed", 1, () =>
      db
        .update(analyticsSite)
        .set({ firstEventAt: new Date(at) })
        .where(and(eq(analyticsSite.id, siteId), isNull(analyticsSite.firstEventAt))),
    );
  }
}

/** Delete sessions older than retention, in bounded chunks so the sweep
 *  never holds a long transaction (events age out by partition DROP). */
export async function pruneExpiredSessions(cutoffMs: number): Promise<void> {
  for (let i = 0; i < PRUNE_MAX_CHUNKS; i++) {
    const deleted = await attempt("session-prune-failed", 0, () =>
      db
        .delete(analyticsSession)
        .where(
          inArray(
            analyticsSession.id,
            db
              .select({ id: analyticsSession.id })
              .from(analyticsSession)
              .where(lt(analyticsSession.lastAt, new Date(cutoffMs)))
              .limit(PRUNE_CHUNK),
          ),
        )
        .returning({ id: analyticsSession.id }),
    );
    if (deleted === null || deleted.length < PRUNE_CHUNK) return;
  }
}
