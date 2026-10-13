import type { JsonObject } from "@otterdeploy/shared/json";

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  bytea,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
} from "drizzle-orm/pg-core";

import {
  healthMetricRollupColumns,
  healthProbeRollupColumns,
  healthRecordColumns,
  healthSeriesRef,
} from "./health-data";

/**
 * The RANGE-partitioned health tables (see ./health-data.ts for the family).
 *
 * IMPORTANT: drizzle-kit does not manage these. They are excluded from the
 * schema barrel and from `tablesFilter` in drizzle.config.ts; the parents,
 * their indexes and keys are created by the hand-written part of the
 * `health_data` migration, and child partitions are created ahead and dropped
 * by packages/api/src/health-data/partitions.ts. These definitions exist only
 * for typed queries. Keep the three in sync by hand.
 *
 * Partition keys: event time `t` (raw, ledger) or `bucket` (rollups), both
 * epoch milliseconds. A partitioned table's primary key must include its
 * partition key, which every key below does.
 */

/** Raw probe results (48 h): payload detail the ledger does not keep. */
export const healthProbeRaw = pgTable(
  "health_probe_raw",
  {
    seriesId: healthSeriesRef(),
    t: bigint("t", { mode: "number" }).notNull(),
    boot: bigint("boot", { mode: "number" }).notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    round: bigint("round", { mode: "number" }).notNull(),
    state: smallint("state").notNull(),
    outcome: smallint("outcome").notNull(),
    cause: smallint("cause").notNull(),
    latUs: integer("lat_us"),
    attUs: integer("att_us").array(),
    uncMs: integer("unc_ms").notNull(),
    receivedAt: bigint("received_at", { mode: "number" }).notNull(),
    live: boolean("live").notNull(),
    detail: jsonb("detail").$type<JsonObject>(),
  },
  (t) => [index("health_probe_raw_series_t").on(t.seriesId, t.t)],
);

/** Raw metric samples (48 h). */
export const healthMetricRaw = pgTable(
  "health_metric_raw",
  {
    seriesId: healthSeriesRef(),
    t: bigint("t", { mode: "number" }).notNull(),
    boot: bigint("boot", { mode: "number" }).notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    uncMs: integer("unc_ms").notNull(),
    receivedAt: bigint("received_at", { mode: "number" }).notNull(),
    live: boolean("live").notNull(),
    vals: real("vals").array().notNull(),
  },
  (t) => [index("health_metric_raw_series_t").on(t.seriesId, t.t)],
);

/**
 * The correction ledger (7 days + 5 minutes): every record that can influence
 * a bucket, compact enough to rebuild any bucket of the replay horizon.
 */
export const healthLedger = pgTable(
  "health_ledger",
  {
    ...healthRecordColumns(),
    digest: bytea("digest").notNull(),
    recId: bigint("rec_id", { mode: "number" })
      .notNull()
      .default(sql`nextval('health_ledger_rec')`),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.t, t.boot, t.seq] }),
    index("health_ledger_identity").on(t.seriesId, t.boot, t.seq),
  ],
);

export const healthProbeR10m = pgTable("health_probe_r10m", healthProbeRollupColumns(), (t) => [
  primaryKey({ columns: [t.seriesId, t.bucket] }),
]);

export const healthProbeR1h = pgTable("health_probe_r1h", healthProbeRollupColumns(), (t) => [
  primaryKey({ columns: [t.seriesId, t.bucket] }),
]);

export const healthMetricR10m = pgTable("health_metric_r10m", healthMetricRollupColumns(), (t) => [
  primaryKey({ columns: [t.seriesId, t.bucket] }),
]);

export const healthMetricR1h = pgTable("health_metric_r1h", healthMetricRollupColumns(), (t) => [
  primaryKey({ columns: [t.seriesId, t.bucket] }),
]);

export type HealthLedgerRow = typeof healthLedger.$inferSelect;
export type HealthProbeRollupRow = typeof healthProbeR10m.$inferSelect;
export type HealthMetricRollupRow = typeof healthMetricR10m.$inferSelect;
