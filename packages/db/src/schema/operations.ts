import { createId } from "@otterdeploy/utils";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { project, environment, resource } from "./project";
import { secretReference } from "./secrets";
import { sslStatusEnum, backupStatusEnum } from "./enums";

export const customDomain = pgTable(
  "custom_domain",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    verified: boolean("verified").notNull().default(false),
    verificationToken: text("verification_token"),
    sslStatus: sslStatusEnum("ssl_status").notNull().default("pending"),
    sslExpiresAt: timestamp("ssl_expires_at"),
    redirectRules: jsonb("redirect_rules")
      .$type<
        Array<{
          source: string;
          target: string;
          statusCode: 301 | 302;
          type: "www" | "custom";
        }>
      >()
      .default([]),
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
    id: text("id").primaryKey().$defaultFn(createId),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    environmentId: text("environment_id").references(() => environment.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").references(() => resource.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    secretReferenceId: text("secret_reference_id").references(() => secretReference.id, {
      onDelete: "set null",
    }),
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
    index("env_var_project_idx").on(table.projectId),
    index("env_var_environment_idx").on(table.environmentId),
    index("env_var_resource_idx").on(table.resourceId),
    index("env_var_secret_ref_idx").on(table.secretReferenceId),
    uniqueIndex("env_var_project_key_unique").on(table.projectId, table.key),
    uniqueIndex("env_var_environment_key_unique").on(table.environmentId, table.key),
    uniqueIndex("env_var_resource_key_unique").on(table.resourceId, table.key),
    check(
      "env_var_exactly_one_scope",
      sql`(
        (project_id IS NOT NULL)::int +
        (environment_id IS NOT NULL)::int +
        (resource_id IS NOT NULL)::int
      ) = 1`,
    ),
  ],
);

export const backup = pgTable(
  "backup",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: backupStatusEnum("status").notNull().default("pending"),
    storageKey: text("storage_key"),
    size: bigint("size", { mode: "number" }),
    checksum: text("checksum"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    expiresAt: timestamp("expires_at"),
    errorMessage: text("error_message"),
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
    id: text("id").primaryKey().$defaultFn(createId),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    actorType: text("actor_type").notNull().default("user"),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorLabel: text("actor_label").notNull().default("user"),
    // Deprecated, kept for backward compatibility with existing readers.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
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
    index("audit_log_actor_user_idx").on(table.actorUserId),
    index("audit_log_actor_type_idx").on(table.actorType),
    index("audit_log_user_idx").on(table.userId),
    check(
      "audit_log_actor_type_check",
      sql`${table.actorType} in ('user', 'system')`,
    ),
  ],
);

export const notificationChannel = pgTable(
  "notification_channel",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    eventFilter: jsonb("event_filter"),
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

// --- Relations ---

export const customDomainRelations = relations(customDomain, ({ one }) => ({
  organization: one(organization, {
    fields: [customDomain.organizationId],
    references: [organization.id],
  }),
  resource: one(resource, {
    fields: [customDomain.resourceId],
    references: [resource.id],
  }),
}));

export const environmentVariableRelations = relations(environmentVariable, ({ one }) => ({
  organization: one(organization, {
    fields: [environmentVariable.organizationId],
    references: [organization.id],
  }),
  project: one(project, {
    fields: [environmentVariable.projectId],
    references: [project.id],
  }),
  environment: one(environment, {
    fields: [environmentVariable.environmentId],
    references: [environment.id],
  }),
  resource: one(resource, {
    fields: [environmentVariable.resourceId],
    references: [resource.id],
  }),
  secretReference: one(secretReference, {
    fields: [environmentVariable.secretReferenceId],
    references: [secretReference.id],
  }),
}));

export const backupRelations = relations(backup, ({ one }) => ({
  organization: one(organization, {
    fields: [backup.organizationId],
    references: [organization.id],
  }),
  resource: one(resource, {
    fields: [backup.resourceId],
    references: [resource.id],
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
