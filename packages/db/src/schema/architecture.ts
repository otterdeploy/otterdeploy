import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user, organization } from "./auth";
import { buildMethodEnum, builderEnum, restartPolicyEnum, databaseTypeEnum } from "./enums";

export const resourceKindEnum = pgEnum("resource_kind", [
  "web",
  "api",
  "worker",
  "database",
  "cache",
  "volume",
]);

export const resourceStatusEnum = pgEnum("resource_status", [
  "online",
  "degraded",
  "crashed",
  "deploying",
  "stopped",
  "unknown",
]);

export const resourceLinkTypeEnum = pgEnum("resource_link_type", [
  "depends_on",
  "network",
  "mounts",
]);

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

export const projectEnvironment = pgTable(
  "project_environment",
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
    index("project_environment_projectId_idx").on(table.projectId),
    uniqueIndex("project_environment_project_name_uidx").on(table.projectId, table.name),
  ],
);

export const projectResource = pgTable(
  "project_resource",
  {
    id: text("id").primaryKey(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => projectEnvironment.id, { onDelete: "cascade" }),
    kind: resourceKindEnum("kind").notNull(),
    name: text("name").notNull(),
    status: resourceStatusEnum("status").notNull().default("unknown"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    posX: doublePrecision("pos_x").notNull().default(0),
    posY: doublePrecision("pos_y").notNull().default(0),
    buildMethod: buildMethodEnum("build_method").default("nixpacks"),
    builder: builderEnum("builder"),
    dockerfilePath: text("dockerfile_path").default("Dockerfile"),
    buildCommand: text("build_command"),
    watchPatterns: jsonb("watch_patterns").$type<string[]>(),
    port: integer("port"),
    healthCheckPath: text("health_check_path"),
    healthCheckInterval: integer("health_check_interval").default(30),
    healthCheckTimeout: integer("health_check_timeout"),
    replicas: integer("replicas").default(1),
    cpuLimit: real("cpu_limit"),
    memoryLimit: integer("memory_limit"),
    startCommand: text("start_command"),
    preDeployCommand: text("pre_deploy_command"),
    restartPolicy: restartPolicyEnum("restart_policy"),
    restartPolicyMaxRetries: integer("restart_policy_max_retries"),
    cronSchedule: text("cron_schedule"),
    region: text("region"),
    sleepApplication: boolean("sleep_application").default(false),
    overlapSeconds: integer("overlap_seconds"),
    drainingSeconds: integer("draining_seconds"),
    serverId: text("server_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("project_resource_environmentId_idx").on(table.environmentId),
    index("project_resource_kind_idx").on(table.kind),
  ],
);

export const projectResourceLink = pgTable(
  "project_resource_link",
  {
    id: text("id").primaryKey(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => projectEnvironment.id, { onDelete: "cascade" }),
    sourceResourceId: text("source_resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    targetResourceId: text("target_resource_id")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    linkType: resourceLinkTypeEnum("link_type").notNull().default("network"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("project_resource_link_environmentId_idx").on(table.environmentId),
    index("project_resource_link_source_idx").on(table.sourceResourceId),
    index("project_resource_link_target_idx").on(table.targetResourceId),
  ],
);

export const projectViewport = pgTable(
  "project_viewport",
  {
    environmentId: text("environment_id")
      .primaryKey()
      .references(() => projectEnvironment.id, { onDelete: "cascade" }),
    x: doublePrecision("x").notNull().default(0),
    y: doublePrecision("y").notNull().default(0),
    zoom: doublePrecision("zoom").notNull().default(1),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("project_viewport_environmentId_idx").on(table.environmentId)],
);

export const databaseConfig = pgTable(
  "database_config",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    databaseType: databaseTypeEnum("database_type").notNull(),
    image: text("image").notNull(),
    databaseName: text("database_name"),
    databaseUser: text("database_user"),
    externalPort: integer("external_port"),
    customConfig: text("custom_config"),
    typeConfig: jsonb("type_config")
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
    index("database_config_resource_idx").on(table.resourceId),
    index("database_config_type_idx").on(table.databaseType),
  ],
);

export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, {
    fields: [project.organizationId],
    references: [organization.id],
  }),
  owner: one(user, {
    fields: [project.ownerId],
    references: [user.id],
  }),
  environments: many(projectEnvironment),
}));

export const projectEnvironmentRelations = relations(projectEnvironment, ({ one, many }) => ({
  project: one(project, {
    fields: [projectEnvironment.projectId],
    references: [project.id],
  }),
  resources: many(projectResource),
  links: many(projectResourceLink),
  viewport: one(projectViewport, {
    fields: [projectEnvironment.id],
    references: [projectViewport.environmentId],
  }),
}));

export const projectResourceRelations = relations(projectResource, ({ one, many }) => ({
  environment: one(projectEnvironment, {
    fields: [projectResource.environmentId],
    references: [projectEnvironment.id],
  }),
  databaseConfig: one(databaseConfig, {
    fields: [projectResource.id],
    references: [databaseConfig.resourceId],
  }),
  outgoingLinks: many(projectResourceLink, {
    relationName: "resource_outgoing_links",
  }),
  incomingLinks: many(projectResourceLink, {
    relationName: "resource_incoming_links",
  }),
}));

export const databaseConfigRelations = relations(databaseConfig, ({ one }) => ({
  resource: one(projectResource, {
    fields: [databaseConfig.resourceId],
    references: [projectResource.id],
  }),
}));

export const projectResourceLinkRelations = relations(projectResourceLink, ({ one }) => ({
  environment: one(projectEnvironment, {
    fields: [projectResourceLink.environmentId],
    references: [projectEnvironment.id],
  }),
  sourceResource: one(projectResource, {
    fields: [projectResourceLink.sourceResourceId],
    references: [projectResource.id],
    relationName: "resource_outgoing_links",
  }),
  targetResource: one(projectResource, {
    fields: [projectResourceLink.targetResourceId],
    references: [projectResource.id],
    relationName: "resource_incoming_links",
  }),
}));

export const projectViewportRelations = relations(projectViewport, ({ one }) => ({
  environment: one(projectEnvironment, {
    fields: [projectViewport.environmentId],
    references: [projectEnvironment.id],
  }),
}));
