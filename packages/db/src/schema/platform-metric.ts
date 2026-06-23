/**
 * Install-wide platform metrics — a lightweight time series sampled on the same
 * control-plane tick as `resource_metric` (packages/api/src/metrics). Generic
 * `metric` name + numeric `value` so new platform signals (queue backlog, …)
 * can be added without a schema change. Today: aggregate BullMQ queue depth
 * (`queue.waiting` / `queue.active` / `queue.failed`, summed across queues).
 *
 * Short-window dashboard feed, not long-term observability (that stays in OTel);
 * pruned by the same hourly cleanup as resource_metric.
 */
import {
  bigserial,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const platformMetric = pgTable(
  "platform_metric",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    ts: timestamp("ts").notNull().defaultNow(),
    /** Dotted metric name, e.g. `queue.waiting`. */
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
  },
  (t) => [
    // Primary query: one metric's samples within a time window.
    index("platform_metric_metric_ts_idx").on(t.metric, t.ts),
  ],
);

export type PlatformMetricRow = typeof platformMetric.$inferSelect;
export type NewPlatformMetricRow = typeof platformMetric.$inferInsert;
