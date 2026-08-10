/**
 * All-time scanner-probe rollup writer.
 *
 * Every suspicious request seen at ingest is folded into a per-(host, IP)
 * counter row in `edge_threat_ip`. That table is never swept, so the Firewall's
 * flagged-IP panel can answer "everything this IP has ever probed" even though
 * the raw `edge_log` partitions behind it are dropped on a 7-day retention.
 *
 * Deliberately INDEPENDENT of the edge-log persistence toggle: the whole point
 * is a durable threat record, and it costs one upsert per distinct probing IP
 * per flush window, not one row per request. A tail-only install (persistence
 * off) still accumulates history here.
 *
 * Writes are buffered and merged in memory first, so a scanner hammering 400
 * paths in five seconds costs ONE upsert, not 400.
 */

import { db } from "@otterdeploy/db";
import { edgeThreatIp } from "@otterdeploy/db/schema/edge-threat";
import { Result } from "better-result";
import { sql } from "drizzle-orm";
import { log } from "evlog";

import type { EdgeLogLine } from "./types";

import { classifyThreat } from "./threat";

const FLUSH_INTERVAL_MS = 5_000;
/** Distinct (host, ip) pairs held before an early flush. A wide scan sweep can
 *  touch thousands of hosts; this bounds the buffer, not the history. */
const MAX_PENDING = 500;
export const MAX_SAMPLE_PATHS = 5;

/** One buffered (host, ip) group, awaiting its upsert. */
export interface PendingProbe {
  host: string;
  ip: string;
  country: string | null;
  probes: number;
  firstSeen: string;
  lastSeen: string;
  paths: string[];
}

interface RollupState {
  pending: Map<string, PendingProbe>;
  enabled: boolean;
  timer: ReturnType<typeof setInterval> | null;
}

// On globalThis for the same reason as the ring + persist buffers: the sink's
// captured closure and freshly re-imported modules must share ONE buffer across
// `--hot` reloads, or probes accumulate in a map nobody ever flushes. Declared
// rather than cast (`globalThis as … & {…}`), which the assertion ban forbids.
declare global {
  var __edgeThreatRollup: RollupState | undefined;
}

const state: RollupState = (globalThis.__edgeThreatRollup ??= {
  pending: new Map(),
  enabled: false,
  timer: null,
});

export function startThreatRollup(): void {
  if (state.timer) clearInterval(state.timer);
  state.enabled = true;
  state.timer = setInterval(() => void flushThreatRollup(), FLUSH_INTERVAL_MS);
  log.info({ edgeLog: { threatRollup: "started" } });
}

export async function stopThreatRollup(): Promise<void> {
  state.enabled = false;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  await flushThreatRollup();
}

/**
 * Fold one parsed access-log line into the pending rollup. No-op for ordinary
 * traffic and until {@link startThreatRollup}. Never throws: ingest runs on the
 * socket's data handler.
 */
export function recordThreatProbe(line: EdgeLogLine): void {
  if (!state.enabled) return;
  if (!classifyThreat(line.path)) return;
  mergeProbe(state.pending, line);
  if (state.pending.size >= MAX_PENDING) void flushThreatRollup();
}

/** Merge a line into a pending map. Exported for tests: this is the whole
 *  in-memory half of the rollup, and it runs per suspicious request. */
export function mergeProbe(pending: Map<string, PendingProbe>, line: EdgeLogLine): void {
  const host = line.host.toLowerCase();
  const key = `${host} ${line.clientIp}`;
  const existing = pending.get(key);
  if (!existing) {
    pending.set(key, {
      host,
      ip: line.clientIp,
      country: line.country,
      probes: 1,
      firstSeen: line.ts,
      lastSeen: line.ts,
      paths: [line.path],
    });
    return;
  }
  existing.probes += 1;
  if (line.ts < existing.firstSeen) existing.firstSeen = line.ts;
  if (line.ts > existing.lastSeen) existing.lastSeen = line.ts;
  existing.country ??= line.country;
  if (existing.paths.length < MAX_SAMPLE_PATHS && !existing.paths.includes(line.path)) {
    existing.paths.push(line.path);
  }
}

/**
 * Upsert the buffered groups. Counters ADD, `first_seen` keeps the earliest and
 * `last_seen` the latest, and the sample paths merge to a distinct set capped
 * at {@link MAX_SAMPLE_PATHS}. The target table is spelled out (`edge_threat_ip.x`)
 * rather than interpolated from the drizzle column object: inside an ON CONFLICT
 * SET expression drizzle renders a column ref bare, and a bare name in the
 * sub-select's FROM would bind to the wrong scope.
 */
export async function flushThreatRollup(): Promise<void> {
  if (state.pending.size === 0) return;
  const groups = [...state.pending.values()];
  state.pending.clear();

  const res = await Result.tryPromise({
    try: () =>
      db
        .insert(edgeThreatIp)
        .values(
          groups.map((g) => ({
            host: g.host,
            clientIp: g.ip,
            country: g.country,
            probes: g.probes,
            firstSeen: new Date(g.firstSeen),
            lastSeen: new Date(g.lastSeen),
            samplePaths: g.paths,
          })),
        )
        .onConflictDoUpdate({
          target: [edgeThreatIp.host, edgeThreatIp.clientIp],
          set: {
            probes: sql`edge_threat_ip.probes + excluded.probes`,
            firstSeen: sql`least(edge_threat_ip.first_seen, excluded.first_seen)`,
            lastSeen: sql`greatest(edge_threat_ip.last_seen, excluded.last_seen)`,
            country: sql`coalesce(excluded.country, edge_threat_ip.country)`,
            samplePaths: sql`(
              select coalesce(array_agg(p), '{}'::text[])
              from (
                select distinct e as p
                from unnest(edge_threat_ip.sample_paths || excluded.sample_paths) as e
                limit ${MAX_SAMPLE_PATHS}
              ) s
            )`,
          },
        }),
    catch: (cause) => cause,
  });

  if (res.isErr()) {
    log.error({
      edgeLog: { threatRollup: "flush-failed", count: groups.length },
      error: res.error instanceof Error ? res.error.message : String(res.error),
    });
  }
}

/** Test seam: drop buffered groups between tests. */
export function __resetThreatRollup(): void {
  state.pending.clear();
  state.enabled = false;
}
