/**
 * Per-node host metrics: an append-only time series, one row per health
 * sample per server. The sibling of `resource_metric` (per-container) and
 * `platform_metric` (install-wide), for the machines themselves.
 *
 * `server_health_sample` deliberately keeps only the LATEST snapshot per
 * server (primary-keyed on server_id, upserted in place) because the servers
 * list reads it on every page load. That left remote nodes with no history at
 * all, so this table is written in the same call: the snapshot stays the fast
 * "right now" read, this is the "over time" read.
 *
 * Columns, not a jsonb blob: the series is queried by time range and
 * aggregated, which a jsonb payload cannot index or average cheaply. Nearly
 * every series column is nullable because every section of a host-health
 * report is best-effort (a node with no /proc CPU delta yet reports null,
 * never a fake zero).
 *
 * Retention is enforced by the hourly cleanup cron, same window as the other
 * metric tables (this is a live dashboard feed, not long-term observability).
 */
import type { ServerId } from "@otterdeploy/shared/id";

import {
  bigint,
  bigserial,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { server } from "./server";

export const serverMetric = pgTable(
  "server_metric",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    serverId: text("server_id")
      .$type<ServerId>()
      .notNull()
      .references(() => server.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ts: timestamp("ts").notNull().defaultNow(),

    // ── CPU ────────────────────────────────────────────────────────────────
    /** Busy percent of the whole machine, 0–100 (NOT core-summed). Null until
     *  the reporter has two /proc/stat frames to delta. */
    cpuPct: doublePrecision("cpu_pct"),
    cpuUserPct: doublePrecision("cpu_user_pct"),
    cpuSystemPct: doublePrecision("cpu_system_pct"),
    cpuIowaitPct: doublePrecision("cpu_iowait_pct"),
    cpuStealPct: doublePrecision("cpu_steal_pct"),

    // ── memory ─────────────────────────────────────────────────────────────
    memUsedPct: doublePrecision("mem_used_pct").notNull(),
    memAvailableBytes: bigint("mem_available_bytes", { mode: "number" }).notNull(),
    memTotalBytes: bigint("mem_total_bytes", { mode: "number" }).notNull(),
    /** Reclaimable cache, kept out of the used figure on purpose. */
    memCachedBytes: bigint("mem_cached_bytes", { mode: "number" }),
    memBuffersBytes: bigint("mem_buffers_bytes", { mode: "number" }),
    /** ZFS ARC: cache that lives outside `Cached`, so a ZFS host reads as
     *  "full" unless it is charted separately. */
    zfsArcBytes: bigint("zfs_arc_bytes", { mode: "number" }),
    swapUsedPct: doublePrecision("swap_used_pct"),

    // ── disk ───────────────────────────────────────────────────────────────
    /** The data-root filesystem, matching the snapshot's `disk` field. */
    diskUsedPct: doublePrecision("disk_used_pct"),
    diskFreeBytes: bigint("disk_free_bytes", { mode: "number" }),
    /** Summed across every whole block device the reporter saw. */
    diskReadBytesPerSec: bigint("disk_read_bytes_per_sec", { mode: "number" }),
    diskWriteBytesPerSec: bigint("disk_write_bytes_per_sec", { mode: "number" }),

    // ── load & network ─────────────────────────────────────────────────────
    loadAvg1: doublePrecision("load_avg_1"),
    loadAvg5: doublePrecision("load_avg_5"),
    loadAvg15: doublePrecision("load_avg_15"),
    /** Summed across every interface except loopback. */
    netRxBytesPerSec: bigint("net_rx_bytes_per_sec", { mode: "number" }),
    netTxBytesPerSec: bigint("net_tx_bytes_per_sec", { mode: "number" }),
  },
  (t) => [
    // Primary query: one server's samples within a time window.
    index("server_metric_server_ts_idx").on(t.serverId, t.ts),
    // Retention sweep + any org-wide fleet read.
    index("server_metric_org_ts_idx").on(t.organizationId, t.ts),
  ],
);

export type ServerMetricRow = typeof serverMetric.$inferSelect;
export type NewServerMetricRow = typeof serverMetric.$inferInsert;
