import type { OrganizationId } from "@otterdeploy/shared/id";

import {
  bigint,
  bigserial,
  boolean,
  bytea,
  index,
  integer,
  pgSequence,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

/**
 * Health and capacity history: probe results and host/container metrics
 * reported by nodes, the correction ledger they are rebuilt from, and the
 * 10-minute / hourly / daily rollups the UI reads.
 *
 * This file holds the tables drizzle-kit manages: small, unpartitioned
 * bookkeeping. The high-volume tables (raw payloads, the ledger, the
 * 10-minute and hourly rollups) are RANGE-partitioned so retention is a
 * partition drop; drizzle's DSL cannot express PARTITION BY, so their DDL is
 * hand-written in the `health_data` migration and their typed definitions live
 * in ./health-data-partitioned.ts, outside the barrel and excluded from
 * drizzle-kit by `tablesFilter` (the analytics_event precedent).
 *
 * Every time column is integer epoch milliseconds (event time unless named
 * otherwise): the evaluator works in milliseconds and partition bounds are
 * plain integers.
 */

/** Ledger record ids: the high-water mark a rollup bucket records. */
export const healthLedgerRecSeq = pgSequence("health_ledger_rec");

/**
 * One series per full identity: a probe check revision as seen from one
 * vantage, or one metric dimension of one subject on one node. A new check
 * revision or instance generation is a new series, never a continuation, so
 * it starts Unknown instead of inheriting the old series' state.
 *
 * Every other health table references this one with ON DELETE CASCADE, the
 * partitioned ones included, and this one cascades from the organization:
 * deleting an organization deletes all of its health data.
 */
export const healthSeries = pgTable(
  "health_series",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** 1 = probe, 2 = metric. */
    kind: smallint("kind").notNull(),
    /** Node that reports this series (observer for probes, host for metrics). */
    sourceNodeId: text("source_node_id").notNull(),
    /** Canonical identity; the dedupe key. */
    identityKey: text("identity_key").notNull(),
    /** Subject (service instance, container, host): node markers address series by it. */
    subjectId: text("subject_id").notNull(),
    /** Metric dimension set (`host`, `fs:/`, `container`, …); null for probes. */
    dimensionSet: text("dimension_set"),
    /** Probe check and revision: control-plane markers address series by them. Null for metrics. */
    checkId: text("check_id"),
    checkRevision: integer("check_revision"),
    /** Counts against the node dimension quota (host + bounded dimensions). */
    nodeDimension: boolean("node_dimension").notNull(),
    /** Largest TTL any record of this series carried: bounds a rebuild range. */
    maxTtlMs: integer("max_ttl_ms").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("health_series_identity_key").on(t.identityKey),
    index("health_series_org_idx").on(t.organizationId),
    index("health_series_source_idx").on(t.sourceNodeId, t.subjectId),
    index("health_series_check_idx").on(t.organizationId, t.checkId),
  ],
);

/** A series reference that disappears with its series. */
export const healthSeriesRef = () =>
  bigint("series_id", { mode: "number" })
    .notNull()
    .references(() => healthSeries.id, { onDelete: "cascade" });

/**
 * One row per (node, node epoch, kernel boot) that reported. Ledger records
 * carry this id, so a record's identity is (series, boot, sequence) and a new
 * boot never continues the previous boot's state.
 */
export const healthBoot = pgTable(
  "health_boot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sourceNodeId: text("source_node_id").notNull(),
    nodeEpoch: bigint("node_epoch", { mode: "number" }).notNull(),
    bootId: text("boot_id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("health_boot_identity").on(t.sourceNodeId, t.nodeEpoch, t.bootId)],
);

/** The record fields the evaluator needs, shared by the ledger and its anchor. */
export function healthRecordColumns() {
  return {
    seriesId: healthSeriesRef(),
    t: bigint("t", { mode: "number" }).notNull(),
    boot: bigint("boot", { mode: "number" }).notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    kind: smallint("kind").notNull(),
    state: smallint("state").notNull(),
    uncMs: integer("unc_ms").notNull(),
    ttlMs: integer("ttl_ms").notNull(),
    latUs: integer("lat_us"),
    attUs: integer("att_us").array(),
    vals: real("vals").array(),
  };
}

/**
 * The last ledger record of each series from partitions already dropped: the
 * predecessor of the oldest still-correctable range.
 */
export const healthLedgerAnchor = pgTable("health_ledger_anchor", {
  ...healthRecordColumns(),
  seriesId: healthSeriesRef().primaryKey(),
});

/**
 * Rebuild obligations, written in the same transaction as the ledger append:
 * a committed record always has its pending range until a rollup pass that saw
 * it commits.
 */
export const healthRebuildPending = pgTable(
  "health_rebuild_pending",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    seriesId: healthSeriesRef(),
    lo: bigint("lo", { mode: "number" }).notNull(),
    hi: bigint("hi", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("health_rebuild_pending_series_idx").on(t.seriesId)],
);

/**
 * Arrivals that never enter an aggregate: older than the replay horizon, or
 * contradicting an accepted record with the same identity. Kept as visible,
 * audited correction gaps.
 */
export const healthRejected = pgTable(
  "health_rejected",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    seriesId: bigint("series_id", { mode: "number" }).references(() => healthSeries.id, {
      onDelete: "cascade",
    }),
    t: bigint("t", { mode: "number" }).notNull(),
    boot: bigint("boot", { mode: "number" }).notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    /** 1 = older than the replay horizon, 2 = contradiction. */
    reason: smallint("reason").notNull(),
    receivedAt: bigint("received_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("health_rejected_received_idx").on(t.receivedAt),
    index("health_rejected_series_idx").on(t.seriesId),
  ],
);

/** Columns of every probe rollup tier. */
export function healthProbeRollupColumns() {
  return {
    seriesId: healthSeriesRef(),
    bucket: bigint("bucket", { mode: "number" }).notNull(),
    /** Bumped on every content change. */
    ver: integer("ver").notNull(),
    /** Highest ledger record id this bucket was built from. */
    ledgerHw: bigint("ledger_hw", { mode: "number" }).notNull(),
    evalRev: smallint("eval_rev").notNull(),
    /** False while corrections can still change it, or when its repair basis was lost. */
    complete: boolean("complete").notNull(),
    /** healthy, degraded, down, unknown ms; then the same four inside maintenance. */
    durMs: integer("dur_ms").array().notNull(),
    /** Observations whose event time is in the bucket. */
    n: integer("n").notNull(),
    /** DDSketch of successful final-round latency (µs). */
    sketch: bytea("sketch"),
    /** DDSketch of successful attempt latency (µs). */
    attSketch: bytea("att_sketch"),
    /** Digest of the ledger records the bucket was built from. */
    bdigest: bytea("bdigest").notNull(),
  };
}

/** Columns of every metric rollup tier. */
export function healthMetricRollupColumns() {
  return {
    seriesId: healthSeriesRef(),
    bucket: bigint("bucket", { mode: "number" }).notNull(),
    ver: integer("ver").notNull(),
    ledgerHw: bigint("ledger_hw", { mode: "number" }).notNull(),
    evalRev: smallint("eval_rev").notNull(),
    complete: boolean("complete").notNull(),
    n: integer("n").notNull(),
    /** Milliseconds covered by a fresh sample (TTL rule). */
    covMs: integer("cov_ms").notNull(),
    /** Per element; null where nothing was measured. */
    mean: real("mean").array().notNull(),
    max: real("max").array().notNull(),
    /** Samples that measured each element: weights the element's mean in a parent. */
    cnt: integer("cnt").array().notNull(),
    bdigest: bytea("bdigest").notNull(),
  };
}

/** Daily probe tier (400 days, small): a plain table. */
export const healthProbeR1d = pgTable("health_probe_r1d", healthProbeRollupColumns(), (t) => [
  primaryKey({ columns: [t.seriesId, t.bucket] }),
]);

/**
 * Telemetry batches already ingested, by the reporting node's batch id: a
 * resent batch is a no-op. Kept as long as the replay horizon.
 */
export const healthBatch = pgTable(
  "health_batch",
  {
    sourceNodeId: text("source_node_id").notNull(),
    batchId: text("batch_id").notNull(),
    receivedAt: bigint("received_at", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceNodeId, t.batchId] }),
    index("health_batch_received_idx").on(t.receivedAt),
  ],
);

/** Advertised horizons (`horizon_ms`, `raw_horizon_ms`): ingest reads them under FOR SHARE. */
export const healthMeta = pgTable("health_meta", {
  k: text("k").primaryKey(),
  v: bigint("v", { mode: "number" }).notNull(),
});

/** Operational counters (quota refusals, horizon shortenings). */
export const healthCounters = pgTable("health_counters", {
  k: text("k").primaryKey(),
  v: bigint("v", { mode: "number" }).notNull(),
});
