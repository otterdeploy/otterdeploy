import { env } from "@otterdeploy/env/server";
import { defineConfig } from "drizzle-kit";

const PARTITIONED_HEALTH_TABLES = [
  "health_probe_raw",
  "health_metric_raw",
  "health_ledger",
  "health_probe_r10m",
  "health_probe_r1h",
  "health_metric_r10m",
  "health_metric_r1h",
];

export default defineConfig({
  // Point at the barrel, not the directory: drizzle-kit 1.0-rc loads a
  // directory's files AND any re-exporting index, double-counting every
  // table and aborting with "duplicate" errors. The index re-exports every
  // schema file exactly once, so this loads each table a single time.
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  // `edge_log` is a RANGE-partitioned table owned at runtime by
  // packages/api/src/edge-logs/partition.ts and intentionally kept out of the
  // schema barrel. Without this filter, push introspects the live DB, sees the
  // parent + daily child partitions (edge_log_YYYY_MM_DD) it doesn't know about,
  // and queues DROPs for all of them. Dropping the parent cascades to the
  // children, so the separate child DROP then fails with "table ... does not
  // exist" and aborts the push. Excluding them leaves the runtime-managed table
  // untouched. ("*" keeps every other table in drizzle-kit's purview.)
  // `analytics_event` (web-analytics event stream) is partitioned the same
  // way and owned by packages/api/src/analytics/partition.ts.
  // The partitioned health tables (raw payloads, the correction ledger, the
  // 10-minute and hourly rollups) are created by the `health_data` migration's
  // hand-written part and partitioned by packages/api/src/health-data/partitions.ts;
  // children are named `<parent>_p<epoch seconds>`. The `_p*` patterns keep
  // `health_ledger_anchor` (drizzle-managed) out of the exclusion.
  tablesFilter: [
    "*",
    "!edge_log",
    "!edge_log_*",
    "!analytics_event",
    "!analytics_event_*",
    ...PARTITIONED_HEALTH_TABLES.flatMap((t) => [`!${t}`, `!${t}_p*`]),
  ],
});
