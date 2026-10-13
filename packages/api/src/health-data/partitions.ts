/**
 * Child partitions of the partitioned health tables (their parents are
 * created by the `health_data` migration). Partitions are created ahead of
 * ingest and dropped by age (./retention.ts), so retention is a metadata-only
 * DROP, never a bulk DELETE. There is deliberately no DEFAULT partition: a
 * row outside every partition fails loudly instead of landing somewhere that
 * blocks the next partition's creation.
 *
 * Children are named `<parent>_p<start in epoch seconds>`; drizzle.config.ts
 * excludes that pattern from drizzle-kit.
 */
import { db } from "@otterdeploy/db";
import { Result } from "better-result";
import { sql } from "drizzle-orm";
import * as z from "zod";

import {
  DAY,
  floorTo,
  HOUR,
  RAW_RETENTION_MS,
  REPLAY_HORIZON_MS,
  TIER,
  TIER_RETENTION_MS,
} from "./model";
import { type Executor, type HealthDbError, rowsOf, toDbError } from "./sql";

/** A partitioned table: partition width and how long its data is kept. */
export interface PartitionSpec {
  table: PartitionedTable;
  widthMs: number;
  retentionMs: number;
}

const spec = (table: PartitionedTable, widthMs: number, retentionMs: number): PartitionSpec => ({
  table,
  widthMs,
  retentionMs,
});

const SPECS = {
  health_probe_raw: spec("health_probe_raw", 6 * HOUR, RAW_RETENTION_MS),
  health_metric_raw: spec("health_metric_raw", 6 * HOUR, RAW_RETENTION_MS),
  health_ledger: spec("health_ledger", DAY, REPLAY_HORIZON_MS),
  health_probe_r10m: spec("health_probe_r10m", DAY, TIER_RETENTION_MS[TIER.base10m]),
  health_metric_r10m: spec("health_metric_r10m", DAY, TIER_RETENTION_MS[TIER.base10m]),
  health_probe_r1h: spec("health_probe_r1h", 10 * DAY, TIER_RETENTION_MS[TIER.hour]),
  health_metric_r1h: spec("health_metric_r1h", 10 * DAY, TIER_RETENTION_MS[TIER.hour]),
} as const;

export type PartitionedTable =
  | "health_probe_raw"
  | "health_metric_raw"
  | "health_ledger"
  | "health_probe_r10m"
  | "health_metric_r10m"
  | "health_probe_r1h"
  | "health_metric_r1h";

export const PARTITIONS: readonly PartitionSpec[] = Object.values(SPECS);

export const partitionSpec = (table: PartitionedTable): PartitionSpec => SPECS[table];

const partitionName = (spec: PartitionSpec, start: number): string =>
  `${spec.table}_p${Math.floor(start / 1000).toString()}`;

/** Serialises partition DDL across processes (create-ahead races otherwise). */
const PARTITION_LOCK = sql`select pg_advisory_xact_lock(hashtextextended('health-data-partitions', 0))`;

/** Create every partition of `spec` covering [from, to). Returns how many were new. */
export function ensurePartitions(
  spec: PartitionSpec,
  from: number,
  to: number,
): Promise<Result<number, HealthDbError>> {
  return Result.tryPromise({
    catch: toDbError,
    try: () =>
      db.transaction(async (tx) => {
        await tx.execute(PARTITION_LOCK);
        const existing = new Set((await readPartitions(tx, spec)).map((p) => p.start));
        let created = 0;
        for (let start = floorTo(from, spec.widthMs); start < to; start += spec.widthMs) {
          if (existing.has(start)) continue;
          // Bounds are integers computed here (DDL cannot take parameters).
          const bounds = sql.raw(
            `FROM (${start.toFixed(0)}) TO (${(start + spec.widthMs).toFixed(0)})`,
          );
          await tx.execute(
            sql`CREATE TABLE IF NOT EXISTS ${sql.identifier(partitionName(spec, start))} PARTITION OF ${sql.identifier(spec.table)} FOR VALUES ${bounds}`,
          );
          created++;
        }
        return created;
      }),
  });
}

/**
 * Partition maintenance: for every table, partitions from the oldest retained
 * data through the look-ahead (two partitions for day-wide and wider tables,
 * 12 hours for raw). Idempotent; returns how many partitions were created.
 */
export async function ensurePartitionsAhead(now: number): Promise<Result<number, HealthDbError>> {
  let created = 0;
  for (const spec of PARTITIONS) {
    const ahead = spec.widthMs >= DAY ? 2 * spec.widthMs : 12 * HOUR;
    const r = await ensurePartitions(spec, now - spec.retentionMs - spec.widthMs, now + ahead);
    if (r.isErr()) return Result.err(r.error);
    created += r.value;
  }
  return Result.ok(created);
}

const partitionRow = z.object({ name: z.string() });

/** Partitions of `spec` with their start (ms), oldest first; throws on a driver error. */
export async function readPartitions(
  executor: Executor,
  spec: PartitionSpec,
): Promise<Array<{ name: string; start: number }>> {
  const res = await executor.execute(sql`
    select c.relname as name from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      join pg_class p on p.oid = i.inhparent
     where p.relname = ${spec.table}`);
  const prefix = `${spec.table}_p`;
  return rowsOf(res, partitionRow)
    .filter((r) => r.name.startsWith(prefix) && /^\d+$/.test(r.name.slice(prefix.length)))
    .map((r) => ({ name: r.name, start: Number(r.name.slice(prefix.length)) * 1000 }))
    .toSorted((a, b) => a.start - b.start);
}

/** Partitions of `spec` with their start (ms), oldest first. */
export function listPartitions(
  spec: PartitionSpec,
  executor: Executor = db,
): Promise<Result<Array<{ name: string; start: number }>, HealthDbError>> {
  return Result.tryPromise({ catch: toDbError, try: () => readPartitions(executor, spec) });
}
