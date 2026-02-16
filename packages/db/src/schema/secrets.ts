import { relations, sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projectResource } from "./architecture";
import { deployment } from "./deployment";
import {
  secretKindEnum,
  secretLogicalScopeEnum,
  secretProviderBindingStatusEnum,
  secretProviderEnum,
} from "./enums";

export const secretProviderBinding = pgTable(
  "secret_provider_binding",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: secretProviderEnum("provider").notNull().default("infisical"),
    providerProjectId: text("provider_project_id").notNull(),
    providerProjectSlug: text("provider_project_slug").notNull(),
    status: secretProviderBindingStatusEnum("status").notNull().default("provisioning"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("secret_provider_binding_org_uidx").on(table.organizationId),
    index("secret_provider_binding_status_idx").on(table.status),
  ],
);

export const secretReference = pgTable(
  "secret_reference",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: secretProviderEnum("provider").notNull(),
    kind: secretKindEnum("kind").notNull(),
    logicalScope: secretLogicalScopeEnum("logical_scope").notNull(),
    logicalScopeId: text("logical_scope_id").notNull(),
    key: text("key").notNull(),
    providerPath: text("provider_path").notNull(),
    providerKey: text("provider_key").notNull(),
    providerVersion: text("provider_version"),
    lastResolvedAt: timestamp("last_resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("secret_reference_org_idx").on(table.organizationId),
    index("secret_reference_scope_idx").on(table.logicalScope, table.logicalScopeId),
    index("secret_reference_provider_idx").on(table.provider, table.kind),
    uniqueIndex("secret_reference_scope_key_uidx").on(
      table.organizationId,
      table.kind,
      table.logicalScope,
      table.logicalScopeId,
      table.key,
    ),
  ],
);

export const deploymentSecretSnapshot = pgTable(
  "deployment_secret_snapshot",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployment.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    entriesJson: jsonb("entries_json")
      .$type<
        Array<{
          key: string;
          variableId: string;
          scope: "project" | "environment" | "resource";
          secretReferenceId: string | null;
          providerVersion: string | null;
          digest: string;
        }>
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),
    snapshotHash: text("snapshot_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("deployment_secret_snapshot_deployment_uidx").on(table.deploymentId),
    index("deployment_secret_snapshot_org_idx").on(table.organizationId),
    index("deployment_secret_snapshot_resource_idx").on(table.resourceId),
  ],
);

export const secretProviderBindingRelations = relations(secretProviderBinding, ({ one }) => ({
  organization: one(organization, {
    fields: [secretProviderBinding.organizationId],
    references: [organization.id],
  }),
}));

export const secretReferenceRelations = relations(secretReference, ({ one }) => ({
  organization: one(organization, {
    fields: [secretReference.organizationId],
    references: [organization.id],
  }),
}));

export const deploymentSecretSnapshotRelations = relations(
  deploymentSecretSnapshot,
  ({ one }) => ({
    deployment: one(deployment, {
      fields: [deploymentSecretSnapshot.deploymentId],
      references: [deployment.id],
    }),
    organization: one(organization, {
      fields: [deploymentSecretSnapshot.organizationId],
      references: [organization.id],
    }),
    resource: one(projectResource, {
      fields: [deploymentSecretSnapshot.resourceId],
      references: [projectResource.id],
    }),
  }),
);
