import { defineConfig } from "drizzle-kit";
import { env } from "@otterdeploy/env/server";

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
  // and queues DROPs for all of them — dropping the parent cascades to the
  // children, so the separate child DROP then fails with "table ... does not
  // exist" and aborts the push. Excluding them leaves the runtime-managed table
  // untouched. ("*" keeps every other table in drizzle-kit's purview.)
  tablesFilter: ["*", "!edge_log", "!edge_log_*"],
});
