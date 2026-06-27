/**
 * Per-container runtime metrics — a lightweight time series sampled from the
 * Docker stats API on a fixed control-plane tick (packages/api/src/metrics).
 * One row per container per sample. Keyed by the `otterdeploy.resource.id`
 * label so the UI can chart CPU/memory/network for a service node.
 *
 * Retention is handled by the hourly cleanup cron (short window — this is a
 * live dashboard feed, not long-term observability; that stays in OTel).
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import {
  bigint,
  bigserial,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const resourceMetric = pgTable(
  "resource_metric",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    resourceId: text("resource_id").$type<ResourceId>().notNull(),
    // Swarm task / replica container id this sample came from.
    containerId: text("container_id").notNull(),
    ts: timestamp("ts").notNull().defaultNow(),
    // Percentage of one core-equivalent (0–100 * nCPU), Docker-style.
    cpuPct: doublePrecision("cpu_pct").notNull(),
    memBytes: bigint("mem_bytes", { mode: "number" }).notNull(),
    memLimitBytes: bigint("mem_limit_bytes", { mode: "number" }).notNull(),
    netRxBytes: bigint("net_rx_bytes", { mode: "number" }).notNull().default(0),
    netTxBytes: bigint("net_tx_bytes", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    // Primary query: a resource's samples within a time window.
    index("resource_metric_resource_ts_idx").on(t.resourceId, t.ts),
  ],
);

export type ResourceMetricRow = typeof resourceMetric.$inferSelect;
export type NewResourceMetricRow = typeof resourceMetric.$inferInsert;
