import { relations } from "drizzle-orm";
import {
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user, organization } from "./auth";
import { resourceKindEnum, resourceStatusEnum } from "./enums";
import {
  resourceRuntimeConfig,
  resourceBuildConfig,
  resourceJobConfig,
  resourceComposeConfig,
  databaseConfig,
  resourceVolumeMount,
} from "./resource-config";

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .references(() => organization.id, { onDelete: "cascade" }),
    ownerId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    baseDomain: text("base_domain"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("project_slug_org_uidx").on(table.organizationId, table.slug),
    index("project_ownerUserId_idx").on(table.ownerId),
    index("project_org_idx").on(table.organizationId),
  ],
);

export const environment = pgTable(
  "environment",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("environment_projectId_idx").on(table.projectId),
    uniqueIndex("environment_project_name_uidx").on(table.projectId, table.name),
  ],
);

export const resource = pgTable(
  "resource",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    serverId: text("server_id"),
    kind: resourceKindEnum("kind").notNull(),
    name: text("name").notNull(),
    status: resourceStatusEnum("status").notNull().default("unknown"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("resource_org_idx").on(table.organizationId),
    index("resource_environmentId_idx").on(table.environmentId),
    index("resource_kind_idx").on(table.kind),
    index("resource_serverId_idx").on(table.serverId),
  ],
);

export const resourcePosition = pgTable("resource_position", {
  resourceId: text("resource_id")
    .primaryKey()
    .references(() => resource.id, { onDelete: "cascade" }),
  posX: doublePrecision("pos_x").notNull().default(0),
  posY: doublePrecision("pos_y").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const viewport = pgTable("viewport", {
  environmentId: text("environment_id")
    .primaryKey()
    .references(() => environment.id, { onDelete: "cascade" }),
  x: doublePrecision("x").notNull().default(0),
  y: doublePrecision("y").notNull().default(0),
  zoom: doublePrecision("zoom").notNull().default(1),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// --- Relations ---

export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, {
    fields: [project.organizationId],
    references: [organization.id],
  }),
  owner: one(user, {
    fields: [project.ownerId],
    references: [user.id],
  }),
  environments: many(environment),
}));

export const environmentRelations = relations(environment, ({ one, many }) => ({
  project: one(project, {
    fields: [environment.projectId],
    references: [project.id],
  }),
  resources: many(resource),
  viewport: one(viewport, {
    fields: [environment.id],
    references: [viewport.environmentId],
  }),
}));

export const resourceRelations = relations(resource, ({ one, many }) => ({
  organization: one(organization, {
    fields: [resource.organizationId],
    references: [organization.id],
  }),
  project: one(project, {
    fields: [resource.projectId],
    references: [project.id],
  }),
  environment: one(environment, {
    fields: [resource.environmentId],
    references: [environment.id],
  }),
  position: one(resourcePosition, {
    fields: [resource.id],
    references: [resourcePosition.resourceId],
  }),
  runtimeConfig: one(resourceRuntimeConfig, {
    fields: [resource.id],
    references: [resourceRuntimeConfig.resourceId],
  }),
  buildConfig: one(resourceBuildConfig, {
    fields: [resource.id],
    references: [resourceBuildConfig.resourceId],
  }),
  jobConfig: one(resourceJobConfig, {
    fields: [resource.id],
    references: [resourceJobConfig.resourceId],
  }),
  composeConfig: one(resourceComposeConfig, {
    fields: [resource.id],
    references: [resourceComposeConfig.resourceId],
  }),
  databaseConfig: one(databaseConfig, {
    fields: [resource.id],
    references: [databaseConfig.resourceId],
  }),
  volumeMounts: many(resourceVolumeMount),
}));

export const resourcePositionRelations = relations(resourcePosition, ({ one }) => ({
  resource: one(resource, {
    fields: [resourcePosition.resourceId],
    references: [resource.id],
  }),
}));

export const viewportRelations = relations(viewport, ({ one }) => ({
  environment: one(environment, {
    fields: [viewport.environmentId],
    references: [environment.id],
  }),
}));
