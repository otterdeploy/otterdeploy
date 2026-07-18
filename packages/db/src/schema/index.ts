export * from "./audit";
export * from "./auth";
export * from "./backup";
export * from "./blocklist";
export * from "./build";
export * from "./certificates";
export * from "./database-ephemeral";
export * from "./deployment-guest";
// edge_event (operational-log events) IS drizzle-managed — sparse, plain table.
export * from "./edge-event";
// edge_log is intentionally NOT re-exported: it's a RANGE-partitioned table
// (drizzle-kit can't express PARTITION BY), owned by the runtime bootstrap in
// packages/api/src/edge-logs/partition.ts. Import its typed object directly
// from "@otterdeploy/db/schema/edge-log" for queries.
export * from "./git";
export * from "./notification";
export * from "./notification-channel";
export * from "./orphaned-resource";
export * from "./platform";
export * from "./project";
export * from "./platform-metric";
export * from "./proxy-route";
export * from "./resource-metric";
export * from "./server";
export * from "./ssh-key";
export * from "./webhooks";
