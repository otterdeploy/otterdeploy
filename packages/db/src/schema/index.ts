// analytics_site / analytics_session / analytics_event_definition /
// analytics_funnel (web analytics, tracker plane) are drizzle-managed.
export * from "./analytics";
// analytics_event is intentionally NOT re-exported: RANGE-partitioned like
// edge_log, owned by packages/api/src/analytics/partition.ts. Import it from
// "@otterdeploy/db/schema/analytics-event".
export * from "./audit";
export * from "./auth";
export * from "./backup";
export * from "./blocklist";
export * from "./firewall-decision";
export * from "./build";
export * from "./certificates";
export * from "./data-connection";
export * from "./database-ephemeral";
export * from "./deployment-guest";
// edge_event (operational-log events) IS drizzle-managed, sparse, plain table.
export * from "./edge-event";
// edge_stat_minute / edge_stat_day (traffic-analytics rollups, written at
// ingest) are drizzle-managed: bounded row counts, no partitioning needed.
export * from "./edge-stat";
// edge_threat_ip (all-time scanner-probe rollup) likewise: small, plain, and
// deliberately NOT swept with the raw log's retention.
export * from "./edge-threat";
// edge_log is intentionally NOT re-exported: it's a RANGE-partitioned table
// (drizzle-kit can't express PARTITION BY), owned by the runtime bootstrap in
// packages/api/src/edge-logs/partition.ts. Import its typed object directly
// from "@otterdeploy/db/schema/edge-log" for queries.
export * from "./git";
export * from "./mesh";
export * from "./notification";
export * from "./notification-channel";
export * from "./orphaned-resource";
export * from "./platform";
export * from "./project";
export * from "./platform-metric";
export * from "./proxy-route";
export * from "./resource-metric";
export * from "./server";
export * from "./server-metric";
export * from "./server-unit";
export * from "./ssh-key";
export * from "./vault-provider";
export * from "./webhooks";
