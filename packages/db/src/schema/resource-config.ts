import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { resource } from "./project";
import { builderEnum, restartPolicyEnum, databaseTypeEnum } from "./enums";

export const resourceRuntimeConfig = pgTable(
  "resource_runtime_config",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => resource.id, { onDelete: "cascade" }),
    port: integer("port"),
    startCommand: text("start_command"),
    restartPolicy: restartPolicyEnum("restart_policy"),
    restartPolicyMaxRetries: integer("restart_policy_max_retries"),
    replicas: integer("replicas").default(1),
    cpuLimit: real("cpu_limit"),
    memoryLimit: integer("memory_limit"),
    region: text("region"),
    sleepApplication: boolean("sleep_application").default(false),
    healthCheckPath: text("health_check_path"),
    healthCheckInterval: integer("health_check_interval").default(30),
    healthCheckTimeout: integer("health_check_timeout"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("resource_runtime_config_resource_idx").on(table.resourceId)],
);

export const resourceBuildConfig = pgTable(
  "resource_build_config",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => resource.id, { onDelete: "cascade" }),
    registryId: text("registry_id"),
    builder: builderEnum("builder"),
    dockerfilePath: text("dockerfile_path").default("Dockerfile"),
    buildCommand: text("build_command"),
    watchPatterns: text("watch_patterns").array(),
    rootDirectory: text("root_directory").default("/"),
    preDeployCommand: text("pre_deploy_command"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("resource_build_config_resource_idx").on(table.resourceId),
    index("resource_build_config_registry_idx").on(table.registryId),
  ],
);

export const resourceJobConfig = pgTable(
  "resource_job_config",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => resource.id, { onDelete: "cascade" }),
    cronSchedule: text("cron_schedule").notNull(),
    cronCommand: text("cron_command").notNull(),
    overlapSeconds: integer("overlap_seconds"),
    drainingSeconds: integer("draining_seconds"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("resource_job_config_resource_idx").on(table.resourceId)],
);

export const resourceComposeConfig = pgTable(
  "resource_compose_config",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => resource.id, { onDelete: "cascade" }),
    composeFile: text("compose_file").notNull(),
    composePath: text("compose_path").default("docker-compose.yml"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("resource_compose_config_resource_idx").on(table.resourceId)],
);

export const databaseConfig = pgTable(
  "database_config",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => resource.id, { onDelete: "cascade" }),
    databaseType: databaseTypeEnum("database_type").notNull(),
    image: text("image").notNull(),
    databaseName: text("database_name"),
    databaseUser: text("database_user"),
    externalPort: integer("external_port"),
    customConfig: text("custom_config"),
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

export const resourceVolume = pgTable(
  "resource_volume",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    driver: text("driver").default("local"),
    sizeGb: integer("size_gb"),
    storageClass: text("storage_class"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("resource_volume_org_idx").on(table.organizationId)],
);

export const resourceVolumeMount = pgTable(
  "resource_volume_mount",
  {
    id: text("id").primaryKey(),
    volumeId: text("volume_id")
      .notNull()
      .references(() => resourceVolume.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    mountPath: text("mount_path").notNull(),
    readOnly: boolean("read_only").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("resource_volume_mount_volume_idx").on(table.volumeId),
    index("resource_volume_mount_resource_idx").on(table.resourceId),
  ],
);

// --- Relations ---

export const resourceRuntimeConfigRelations = relations(resourceRuntimeConfig, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceRuntimeConfig.resourceId],
    references: [resource.id],
  }),
}));

export const resourceBuildConfigRelations = relations(resourceBuildConfig, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceBuildConfig.resourceId],
    references: [resource.id],
  }),
}));

export const resourceJobConfigRelations = relations(resourceJobConfig, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceJobConfig.resourceId],
    references: [resource.id],
  }),
}));

export const resourceComposeConfigRelations = relations(resourceComposeConfig, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceComposeConfig.resourceId],
    references: [resource.id],
  }),
}));

export const databaseConfigRelations = relations(databaseConfig, ({ one }) => ({
  resource: one(resource, {
    fields: [databaseConfig.resourceId],
    references: [resource.id],
  }),
}));

export const resourceVolumeRelations = relations(resourceVolume, ({ many }) => ({
  mounts: many(resourceVolumeMount),
}));

export const resourceVolumeMountRelations = relations(resourceVolumeMount, ({ one }) => ({
  volume: one(resourceVolume, {
    fields: [resourceVolumeMount.volumeId],
    references: [resourceVolume.id],
  }),
  resource: one(resource, {
    fields: [resourceVolumeMount.resourceId],
    references: [resource.id],
  }),
}));
