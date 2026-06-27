/**
 * Operational-event persistence (edge-logs Phase 3). Batches parsed events into
 * the `edge_event` table behind the live ring, so cert/ACME + upstream-error
 * events survive restarts and outlive the 5k in-memory window. Events are sparse
 * (vs. the high-volume access log), so this is a plain drizzle table with
 * DELETE-based retention — no partitioning.
 *
 * Mirrors persist.ts (buffer + interval flush + retention sweep) and is started
 * from startEdgeLogPersistence so it shares the EDGE_LOG_PERSIST toggle — no
 * separate bootstrap wiring.
 */

import { db } from "@otterdeploy/db";
import { edgeEvent } from "@otterdeploy/db/schema/edge-event";
import { Result } from "better-result";
import { lt } from "drizzle-orm";
import { log } from "evlog";

import type { EdgeEventLine } from "./types";

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 200;
const RETENTION_DAYS = 7;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1_000;

interface EventPersistState {
  buffer: EdgeEventLine[];
  enabled: boolean;
  flushTimer: ReturnType<typeof setInterval> | null;
  sweepTimer: ReturnType<typeof setInterval> | null;
}
const state: EventPersistState = ((
  globalThis as typeof globalThis & {
    __edgeEventPersist?: EventPersistState;
  }
).__edgeEventPersist ??= {
  buffer: [],
  enabled: false,
  flushTimer: null,
  sweepTimer: null,
});

export function startEventPersistence(): void {
  if (state.flushTimer) clearInterval(state.flushTimer);
  if (state.sweepTimer) clearInterval(state.sweepTimer);
  state.enabled = true;
  void flush();
  state.flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  state.sweepTimer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
}

export async function stopEventPersistence(): Promise<void> {
  state.enabled = false;
  if (state.flushTimer) clearInterval(state.flushTimer);
  if (state.sweepTimer) clearInterval(state.sweepTimer);
  state.flushTimer = null;
  state.sweepTimer = null;
  await flush();
}

/** Queue a parsed event for persistence. No-op until startEventPersistence. */
export function enqueueEdgeEvent(line: EdgeEventLine): void {
  if (!state.enabled) return;
  state.buffer.push(line);
  if (state.buffer.length >= MAX_BATCH) void flush();
}

export function eventPersistenceEnabled(): boolean {
  return state.enabled;
}

async function flush(): Promise<void> {
  if (state.buffer.length === 0) return;
  const rows = state.buffer.splice(0, state.buffer.length);
  const res = await Result.tryPromise({
    try: () => db.insert(edgeEvent).values(rows.map(toRow)),
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    log.error({
      edgeLog: { eventPersist: "flush-failed", count: rows.length },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
  }
}

async function sweep(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1_000);
  await Result.tryPromise({
    try: () => db.delete(edgeEvent).where(lt(edgeEvent.ts, cutoff)),
    catch: (cause) => cause,
  });
}

function toRow(l: EdgeEventLine) {
  return {
    ts: new Date(l.ts),
    level: l.level,
    category: l.category,
    logger: l.logger,
    msg: l.msg,
    host: l.host,
    domains: l.domains,
    upstream: l.upstream,
    error: l.error,
    raw: l.raw,
  };
}
