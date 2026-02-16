import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projectResource } from "./architecture";
import { sslStatusEnum, backupStatusEnum, envVarScopeEnum } from "./enums";

export const customDomain = pgTable(
  "custom_domain",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    verified: boolean("verified").notNull().default(false),
    verificationToken: text("verification_token"),
    sslStatus: sslStatusEnum("ssl_status").notNull().default("pending"),
    sslExpiresAt: timestamp("ssl_expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("custom_domain_org_idx").on(table.organizationId),
    index("custom_domain_resource_idx").on(table.resourceId),
    uniqueIndex("custom_domain_domain_unique").on(table.domain),
  ],
);

export const environmentVariable = pgTable(
  "environment_variable",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scope: envVarScopeEnum("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    key: text("key").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    isBuildTime: boolean("is_build_time").notNull().default(false),
    isSecret: boolean("is_secret").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("env_var_org_idx").on(table.organizationId),
    index("env_var_scope_idx").on(table.scope, table.scopeId),
    uniqueIndex("env_var_scope_key_unique").on(
      table.scope,
      table.scopeId,
      table.key,
    ),
  ],
);

export const backup = pgTable(
  "backup",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: backupStatusEnum("status").notNull().default("pending"),
    storageKey: text("storage_key"),
    size: bigint("size", { mode: "number" }),
    checksum: text("checksum"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    expiresAt: timestamp("expires_at"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("backup_org_idx").on(table.organizationId),
    index("backup_resource_idx").on(table.resourceId),
    index("backup_created_idx").on(table.createdAt),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_org_idx").on(table.organizationId),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_created_idx").on(table.createdAt),
    index("audit_log_user_idx").on(table.userId),
  ],
);

export const notificationChannel = pgTable(
  "notification_channel",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("notification_channel_org_idx").on(table.organizationId),
  ],
);

export const customDomainRelations = relations(customDomain, ({ one }) => ({
  organization: one(organization, {
    fields: [customDomain.organizationId],
    references: [organization.id],
  }),
  resource: one(projectResource, {
    fields: [customDomain.resourceId],
    references: [projectResource.id],
  }),
}));

export const backupRelations = relations(backup, ({ one }) => ({
  organization: one(organization, {
    fields: [backup.organizationId],
    references: [organization.id],
  }),
  resource: one(projectResource, {
    fields: [backup.resourceId],
    references: [projectResource.id],
  }),
}));

export const notificationChannelRelations = relations(
  notificationChannel,
  ({ one }) => ({
    organization: one(organization, {
      fields: [notificationChannel.organizationId],
      references: [organization.id],
    }),
  }),
);
