/**
 * Edge-log persistence (Phase 2). Batches parsed access logs into the
 * edge_log table behind the live ring, so 24h/7d ranges and percentiles
 * survive restarts and outlive the in-memory window. Writes are buffered
 * and flushed on an interval (or when the batch fills) to keep ingest cheap
 * under load; a periodic sweep enforces retention.
 */

import { Result } from "better-result";
import { log } from "evlog";

import { db } from "@otterdeploy/db";
import { edgeLog } from "@otterdeploy/db/schema/edge-log";

import {
  dropOldPartitions,
  ensureEdgeLogTable,
  ensurePartitions,
} from "./partition";
import type { EdgeLogLine } from "./types";

const FLUSH_INTERVAL_MS = 2_000;
const MAX_BATCH = 500;
const RETENTION_DAYS = 7;
const SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

// Shared on globalThis so the sink's captured closure and the freshly
// re-imported query module agree on the same buffer + enabled flag across
// `--hot` reloads (see ring.ts for why).
interface PersistState {
  buffer: EdgeLogLine[];
  enabled: boolean;
  /** True once the partitioned table exists — flush() no-ops until then. */
  ready: boolean;
  flushTimer: ReturnType<typeof setInterval> | null;
  sweepTimer: ReturnType<typeof setInterval> | null;
}
const state: PersistState = ((globalThis as typeof globalThis & {
  __edgeLogPersist?: PersistState;
}).__edgeLogPersist ??= {
  buffer: [],
  enabled: false,
  ready: false,
  flushTimer: null,
  sweepTimer: null,
});

export function startEdgeLogPersistence(): void {
  // Idempotent across hot-reloads: clear any prior timers and (re)start.
  if (state.flushTimer) clearInterval(state.flushTimer);
  if (state.sweepTimer) clearInterval(state.sweepTimer);
  state.enabled = true;
  state.ready = false;
  // Create the partitioned table + rolling partitions before the first flush.
  // enqueue() buffers in the meantime; flush() no-ops until `ready`. ensure*
  // log (never throw) on failure, so `ready` still flips and we degrade to
  // logged errors rather than a wedged buffer.
  void (async () => {
    await ensureEdgeLogTable();
    state.ready = true;
    await flush();
  })();
  state.flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  state.sweepTimer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  log.info({ edgeLog: { persist: "started" } });
}

export async function stopEdgeLogPersistence(): Promise<void> {
  state.enabled = false;
  if (state.flushTimer) clearInterval(state.flushTimer);
  if (state.sweepTimer) clearInterval(state.sweepTimer);
  state.flushTimer = null;
  state.sweepTimer = null;
  await flush();
}

/** Queue a parsed line for persistence. No-op until startEdgeLogPersistence. */
export function enqueueEdgeLog(line: EdgeLogLine): void {
  if (!state.enabled) return;
  state.buffer.push(line);
  if (state.buffer.length >= MAX_BATCH) void flush();
}

export function persistenceEnabled(): boolean {
  return state.enabled;
}

async function flush(): Promise<void> {
  // Hold the buffer until the partitioned table is ready — inserting before the
  // partitions exist would fail and drop the batch.
  if (!state.ready || state.buffer.length === 0) return;
  const rows = state.buffer.splice(0, state.buffer.length);
  const res = await Result.tryPromise({
    try: () => db.insert(edgeLog).values(rows.map(toRow)),
    catch: (cause) => cause,
  });
  if (res.isErr()) {
    log.error({
      edgeLog: { persist: "flush-failed", count: rows.length },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
  }
}

async function sweep(): Promise<void> {
  // Keep partitions ahead of ingest, then reclaim space by dropping whole
  // expired partitions — metadata-only, no row-by-row DELETE, no heap bloat.
  await ensurePartitions();
  await dropOldPartitions(RETENTION_DAYS);
}

function toRow(l: EdgeLogLine) {
  return {
    ts: new Date(l.ts),
    method: l.method,
    host: l.host,
    path: l.path,
    status: l.status,
    latencyMs: l.latencyMs,
    clientIp: l.clientIp,
    country: l.country,
    userAgent: l.userAgent,
    referer: l.referer,
    tlsVersion: l.tlsVersion,
    tlsCipher: l.tlsCipher,
    upstream: l.upstream,
    cache: l.cache,
    reqBytes: l.reqBytes,
    resBytes: l.resBytes,
    requestId: l.requestId,
    headers: l.headers,
  };
}
