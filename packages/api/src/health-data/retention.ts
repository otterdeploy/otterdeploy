/**
 * Retention and disk pressure. Partitions are created ahead and dropped by
 * age. Every drop follows one ordering:
 *
 *   publish the new horizon → wait out in-flight readers → drop.
 *
 * Ingest reads both horizons under FOR SHARE inside its transaction
 * (./ingest-write.ts). Publishing is an UPDATE of those rows, so it waits for
 * every batch that read the old value; only after the publish commits are
 * partitions behind it dropped. A batch can therefore never insert into a
 * partition being dropped: it either committed before the publish or reads
 * the new horizon and rejects the expired rows as too old.
 *
 * A ledger partition is dropped only after the last record of every series in
 * it is kept as that series' anchor, the predecessor of the oldest range still
 * correctable. Under disk pressure the raw window shrinks first; then the
 * advertised replay horizon moves forward one data-bearing day per tick,
 * stepping over partitions with nothing to free, in the same transaction that
 * marks the lost repair range incomplete, so seven-day repair is never
 * advertised after its basis is gone. The last level refuses the replay lane
 * (see ./lanes.ts).
 *
 * Exported as a function only: nothing schedules it yet.
 */
import { db } from "@otterdeploy/db";
import {
  healthBatch,
  healthLedgerAnchor,
  healthMeta,
  healthProbeR1d,
  healthRejected,
} from "@otterdeploy/db/schema/health-data";
import {
  healthLedger,
  healthMetricR10m,
  healthProbeR10m,
} from "@otterdeploy/db/schema/health-data-partitioned";
import { Result } from "better-result";
import { lt, sql } from "drizzle-orm";
import * as z from "zod";

import {
  DAY,
  HOUR,
  KIND,
  MINUTE,
  RAW_RETENTION_MS,
  REPLAY_HORIZON_MS,
  TIER_RETENTION_MS,
} from "./model";
import {
  ensurePartitionsAhead,
  readPartitions,
  type PartitionedTable,
  type PartitionSpec,
  partitionSpec,
} from "./partitions";
import { bumpCounter } from "./series";
import { type HealthDbError, rowsOf, toDbError, zNum } from "./sql";

export interface PressureThresholds {
  /** Free fraction below which the raw window shrinks to `rawShrunkMs`. */
  shrinkRaw: number;
  /** Free fraction below which the replay horizon is shortened a data-bearing day per tick. */
  shrinkLedger: number;
  /** Free fraction below which the replay lane is refused. */
  refuseReplay: number;
  rawShrunkMs: number;
}

export const DEFAULT_THRESHOLDS: PressureThresholds = {
  shrinkRaw: 0.2,
  shrinkLedger: 0.12,
  refuseReplay: 0.06,
  rawShrunkMs: 12 * HOUR,
};

/** Free space of the database's disk, read by the caller (never by this module). */
export interface DiskReading {
  freeBytes: number;
  totalBytes: number;
}

export type PressureLevel = 0 | 1 | 2 | 3;

export function pressureLevel(disk: DiskReading, t: PressureThresholds): PressureLevel {
  const free = disk.totalBytes > 0 ? disk.freeBytes / disk.totalBytes : 0;
  if (free < t.refuseReplay) return 3;
  if (free < t.shrinkLedger) return 2;
  if (free < t.shrinkRaw) return 1;
  return 0;
}

export interface RetentionState {
  level: PressureLevel;
  horizonMs: number;
  rawHorizonMs: number;
  /** The horizon moved early under disk pressure this tick. */
  shortened: boolean;
  dropped: string[];
}

const metaRow = z.object({ k: z.string(), v: zNum });

async function readMeta(): Promise<{ horizon: number; rawHorizon: number }> {
  const rows = rowsOf(
    await db.execute(
      sql`select k, v from ${healthMeta} where k in ('horizon_ms', 'raw_horizon_ms')`,
    ),
    metaRow,
  );
  return {
    horizon: rows.find((r) => r.k === "horizon_ms")?.v ?? 0,
    rawHorizon: rows.find((r) => r.k === "raw_horizon_ms")?.v ?? 0,
  };
}

/** Publish a horizon (never backwards). Waits for every ingest holding the row FOR SHARE. */
const publish = (key: "horizon_ms" | "raw_horizon_ms", value: number) =>
  sql`update ${healthMeta} set v = greatest(${healthMeta.v}, ${value}) where k = ${key}`;

async function dropPartitionsBefore(table: PartitionedTable, cutoff: number): Promise<string[]> {
  const spec = partitionSpec(table);
  const dropped: string[] = [];
  for (const p of await readPartitions(db, spec)) {
    if (p.start + spec.widthMs > cutoff) break;
    await db.execute(sql`drop table if exists ${sql.identifier(p.name)}`);
    dropped.push(p.name);
  }
  return dropped;
}

/** Raw window: 48 h, or shrunk under pressure. Publish, then drop. */
async function raw(now: number, level: PressureLevel, t: PressureThresholds, current: number) {
  const window = level >= 1 ? t.rawShrunkMs : RAW_RETENTION_MS;
  const rawHorizon = Math.max(current, now - window);
  await db.transaction((tx) => tx.execute(publish("raw_horizon_ms", rawHorizon)));
  const dropped = [
    ...(await dropPartitionsBefore("health_probe_raw", rawHorizon)),
    ...(await dropPartitionsBefore("health_metric_raw", rawHorizon)),
  ];
  return { rawHorizon, dropped };
}

const existsRow = z.object({ found: z.boolean() });

/**
 * Under pressure: the end of the oldest partition still holding correctable
 * records (end past the horizon, not empty), never closer than a day to now.
 * Partitions already behind the horizon, or empty, free nothing and are
 * stepped over; otherwise the horizon could stall on them forever.
 */
async function shortenedHorizon(spec: PartitionSpec, horizon: number, now: number) {
  for (const p of await readPartitions(db, spec)) {
    const end = p.start + spec.widthMs;
    if (end <= horizon) continue;
    if (end >= now - DAY) return horizon;
    const [row] = rowsOf(
      await db.execute(sql`select exists (select 1 from ${sql.identifier(p.name)}) as found`),
      existsRow,
    );
    if (row?.found) return end;
  }
  return horizon;
}

/** Advertise the horizon; when it moves early, mark the repair range it gives up incomplete in the same transaction. */
async function publishHorizon(previous: number, horizon: number, early: boolean) {
  await db.transaction(async (tx) => {
    await tx.execute(publish("horizon_ms", horizon));
    if (!early) return;
    const from = previous - 10 * MINUTE;
    for (const table of [healthProbeR10m, healthMetricR10m]) {
      await tx.execute(
        sql`update ${table} set complete = false where bucket >= ${from} and bucket < ${horizon}`,
      );
    }
    await tx.execute(bumpCounter("horizon_shortened"));
  });
}

/** Anchor each series' last record of the partition, then detach and drop it, in one transaction. */
async function anchorAndDrop(name: string) {
  await db.transaction(async (tx) => {
    const part = sql.identifier(name);
    await tx.execute(sql`
      insert into ${healthLedgerAnchor} (series_id, t, boot, seq, kind, state, unc_ms, ttl_ms, lat_us, att_us, vals)
      select distinct on (series_id) series_id, t, boot, seq, kind, state, unc_ms, ttl_ms, lat_us, att_us, vals
        from ${part} where kind <> ${KIND.diagnostic} order by series_id, t desc, boot desc, seq desc
      on conflict (series_id) do update set t = excluded.t, boot = excluded.boot, seq = excluded.seq,
        kind = excluded.kind, state = excluded.state, unc_ms = excluded.unc_ms, ttl_ms = excluded.ttl_ms,
        lat_us = excluded.lat_us, att_us = excluded.att_us, vals = excluded.vals
      where excluded.t > ${healthLedgerAnchor.t}`);
    await tx.execute(sql`alter table ${healthLedger} detach partition ${part}`);
    await tx.execute(sql`drop table ${part}`);
  });
}

async function ledger(now: number, level: PressureLevel, current: number) {
  const spec = partitionSpec("health_ledger");
  const natural = Math.max(current, now - REPLAY_HORIZON_MS);
  const horizon = level >= 2 ? await shortenedHorizon(spec, natural, now) : natural;
  const shortened = horizon > natural;
  await publishHorizon(natural, horizon, shortened);
  const dropped: string[] = [];
  for (const p of await readPartitions(db, spec)) {
    if (p.start + spec.widthMs > horizon) break;
    await anchorAndDrop(p.name);
    dropped.push(p.name);
  }
  return { horizon, shortened, dropped };
}

async function rollups(now: number): Promise<string[]> {
  const dropped: string[] = [];
  for (const table of [
    "health_probe_r10m",
    "health_metric_r10m",
    "health_probe_r1h",
    "health_metric_r1h",
  ] as const) {
    dropped.push(...(await dropPartitionsBefore(table, now - partitionSpec(table).retentionMs)));
  }
  await db.delete(healthProbeR1d).where(lt(healthProbeR1d.bucket, now - TIER_RETENTION_MS[3]));
  await db.delete(healthRejected).where(lt(healthRejected.receivedAt, now - 7 * DAY));
  // A batch older than the replay horizon can no longer be accepted anyway;
  // its records' own identities still dedupe a resend.
  await db.delete(healthBatch).where(lt(healthBatch.receivedAt, now - REPLAY_HORIZON_MS));
  return dropped;
}

/** One retention tick. `disk` is the database disk's free space, read by the caller. */
export function runRetention(opts: {
  now: number;
  disk: DiskReading;
  thresholds?: PressureThresholds;
}): Promise<Result<RetentionState, HealthDbError>> {
  const t = opts.thresholds ?? DEFAULT_THRESHOLDS;
  return Result.tryPromise({
    catch: toDbError,
    try: async () => {
      const ensured = await ensurePartitionsAhead(opts.now);
      if (ensured.isErr()) throw ensured.error;
      const level = pressureLevel(opts.disk, t);
      const meta = await readMeta();
      const r = await raw(opts.now, level, t, meta.rawHorizon);
      const l = await ledger(opts.now, level, meta.horizon);
      const old = await rollups(opts.now);
      return {
        level,
        horizonMs: l.horizon,
        rawHorizonMs: r.rawHorizon,
        shortened: l.shortened,
        dropped: [...r.dropped, ...l.dropped, ...old],
      };
    },
  });
}
