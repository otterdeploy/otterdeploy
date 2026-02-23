import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projectResource } from "./architecture";
import { server } from "./infrastructure";
import { caddyStatusEnum } from "./enums";

// Time-series container stats (30s collection, 7-day retention for raw)
export const resourceMetric = pgTable(
  "resource_metric",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp").notNull(),
    cpuPercent: doublePrecision("cpu_percent"),
    memoryUsed: bigint("memory_used", { mode: "number" }),
    memoryLimit: bigint("memory_limit", { mode: "number" }),
    networkRx: bigint("network_rx", { mode: "number" }),
    networkTx: bigint("network_tx", { mode: "number" }),
    diskRead: bigint("disk_read", { mode: "number" }),
    diskWrite: bigint("disk_write", { mode: "number" }),
  },
  (table) => [
    index("resource_metric_resource_ts_idx").on(table.resourceId, table.timestamp),
    index("resource_metric_ts_idx").on(table.timestamp),
  ],
);

// Hourly rollup aggregates (90-day retention)
export const resourceMetricHourly = pgTable(
  "resource_metric_hourly",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp").notNull(),
    cpuAvg: doublePrecision("cpu_avg"),
    cpuMax: doublePrecision("cpu_max"),
    cpuP95: doublePrecision("cpu_p95"),
    memoryAvg: bigint("memory_avg", { mode: "number" }),
    memoryMax: bigint("memory_max", { mode: "number" }),
    memoryP95: bigint("memory_p95", { mode: "number" }),
    networkRxTotal: bigint("network_rx_total", { mode: "number" }),
    networkTxTotal: bigint("network_tx_total", { mode: "number" }),
    diskReadTotal: bigint("disk_read_total", { mode: "number" }),
    diskWriteTotal: bigint("disk_write_total", { mode: "number" }),
  },
  (table) => [
    index("resource_metric_hourly_resource_ts_idx").on(table.resourceId, table.timestamp),
    index("resource_metric_hourly_ts_idx").on(table.timestamp),
  ],
);

// Webhook replay protection (72-hour TTL)
export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("webhook_delivery_created_idx").on(table.createdAt),
  ],
);

// Docker registry credentials
export const containerRegistry = pgTable(
  "container_registry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    username: text("username"),
    passwordSecretRef: text("password_secret_ref"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("container_registry_org_idx").on(table.organizationId),
  ],
);

// File mounts for containers (Docker configs)
export const configFile = pgTable(
  "config_file",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    content: text("content").notNull(),
    mountPath: text("mount_path").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("config_file_resource_idx").on(table.resourceId),
    index("config_file_org_idx").on(table.organizationId),
  ],
);

// Cron job execution history
export const scheduledTaskExecution = pgTable(
  "scheduled_task_execution",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    cronExpression: text("cron_expression"),
    status: text("status").notNull().default("pending"),
    exitCode: integer("exit_code"),
    stdout: text("stdout"),
    stderr: text("stderr"),
    duration: integer("duration"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("scheduled_task_resource_idx").on(table.resourceId),
    index("scheduled_task_org_idx").on(table.organizationId),
    index("scheduled_task_created_idx").on(table.createdAt),
  ],
);

// Caddy instance status per server
export const caddyInstance = pgTable(
  "caddy_instance",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .notNull()
      .references(() => server.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: caddyStatusEnum("caddy_status").notNull().default("not_installed"),
    version: text("version"),
    acmeEmail: text("acme_email"),
    lastHealthCheckAt: timestamp("last_health_check_at"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("caddy_instance_server_idx").on(table.serverId),
    index("caddy_instance_org_idx").on(table.organizationId),
  ],
);

// Backup configuration per resource
export const backupSchedule = pgTable(
  "backup_schedule",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    cronExpression: text("cron_expression").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    retentionCount: integer("retention_count").default(10),
    retentionDays: integer("retention_days").default(30),
    retentionMaxSizeGb: integer("retention_max_size_gb"),
    s3Bucket: text("s3_bucket"),
    s3Region: text("s3_region"),
    s3Endpoint: text("s3_endpoint"),
    s3AccessKeyRef: text("s3_access_key_ref"),
    s3SecretKeyRef: text("s3_secret_key_ref"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("backup_schedule_resource_idx").on(table.resourceId),
    index("backup_schedule_org_idx").on(table.organizationId),
  ],
);

// Relations for new tables
export const resourceMetricRelations = relations(resourceMetric, ({ one }) => ({
  resource: one(projectResource, {
    fields: [resourceMetric.resourceId],
    references: [projectResource.id],
  }),
}));

export const containerRegistryRelations = relations(containerRegistry, ({ one }) => ({
  organization: one(organization, {
    fields: [containerRegistry.organizationId],
    references: [organization.id],
  }),
}));

export const configFileRelations = relations(configFile, ({ one }) => ({
  resource: one(projectResource, {
    fields: [configFile.resourceId],
    references: [projectResource.id],
  }),
  organization: one(organization, {
    fields: [configFile.organizationId],
    references: [organization.id],
  }),
}));

export const caddyInstanceRelations = relations(caddyInstance, ({ one }) => ({
  server: one(server, {
    fields: [caddyInstance.serverId],
    references: [server.id],
  }),
  organization: one(organization, {
    fields: [caddyInstance.organizationId],
    references: [organization.id],
  }),
}));

export const backupScheduleRelations = relations(backupSchedule, ({ one }) => ({
  resource: one(projectResource, {
    fields: [backupSchedule.resourceId],
    references: [projectResource.id],
  }),
  organization: one(organization, {
    fields: [backupSchedule.organizationId],
    references: [organization.id],
  }),
}));
