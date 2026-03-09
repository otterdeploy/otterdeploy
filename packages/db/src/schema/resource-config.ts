import { createId } from "@otterdeploy/utils";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  uniqueIndex,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { resource } from "./project";
import { builderEnum, restartPolicyEnum, databaseTypeEnum, portProtocolEnum, portVisibilityEnum } from "./enums";

export const resourceRuntimeConfig = pgTable(
  "resource_runtime_config",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => resource.id, { onDelete: "cascade" }),
    startCommand: text("start_command"),
    restartPolicy: restartPolicyEnum("restart_policy"),
    restartPolicyMaxRetries: integer("restart_policy_max_retries"),
    replicas: integer("replicas").default(1),
    cpuLimit: real("cpu_limit"),
    memoryLimit: integer("memory_limit"),
    region: text("region"),
    cronSchedule: text("cron_schedule"),
    cronCommand: text("cron_command"),
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
    id: text("id").primaryKey().$defaultFn(createId),
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

// --- Database Engine Config Types (discriminated union) ---

interface BaseDatabaseEngine {
  image: string;
  version?: string;
  persistenceEnabled?: boolean;
  backupEnabled?: boolean;
  memoryLimit?: number;
  cpuLimit?: number;
}

interface PostgresEngineConfig extends BaseDatabaseEngine {
  engine: "postgresql";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  sharedBuffers?: string;
  extensions?: string[];
}

interface MySqlEngineConfig extends BaseDatabaseEngine {
  engine: "mysql";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  innodbBufferPoolSize?: string;
}

interface MariaDbEngineConfig extends BaseDatabaseEngine {
  engine: "mariadb";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  innodbBufferPoolSize?: string;
}

interface MongoEngineConfig extends BaseDatabaseEngine {
  engine: "mongodb";
  databaseName: string;
  replicaSet?: string;
  wiredTigerCacheSize?: string;
}

interface RedisEngineConfig extends BaseDatabaseEngine {
  engine: "redis";
  maxMemory?: string;
  evictionPolicy?: "noeviction" | "allkeys-lru" | "volatile-lru" | "allkeys-random" | "volatile-random" | "volatile-ttl";
  appendOnly?: boolean;
}

interface KeyDbEngineConfig extends BaseDatabaseEngine {
  engine: "keydb";
  maxMemory?: string;
  evictionPolicy?: "noeviction" | "allkeys-lru" | "volatile-lru" | "allkeys-random" | "volatile-random" | "volatile-ttl";
  activeReplica?: boolean;
  multiMaster?: boolean;
}

interface DragonflyEngineConfig extends BaseDatabaseEngine {
  engine: "dragonfly";
  maxMemory?: string;
  cacheMode?: boolean;
}

interface ClickHouseEngineConfig extends BaseDatabaseEngine {
  engine: "clickhouse";
  databaseName: string;
  databaseUser: string;
  maxMemoryUsage?: string;
}

export type DatabaseEngineConfig =
  | PostgresEngineConfig
  | MySqlEngineConfig
  | MariaDbEngineConfig
  | MongoEngineConfig
  | RedisEngineConfig
  | KeyDbEngineConfig
  | DragonflyEngineConfig
  | ClickHouseEngineConfig;

export const databaseConfig = pgTable(
  "database_config",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => resource.id, { onDelete: "cascade" }),
    engine: databaseTypeEnum("engine").notNull(),
    config: jsonb("config").$type<DatabaseEngineConfig>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("database_config_resource_idx").on(table.resourceId),
    index("database_config_engine_idx").on(table.engine),
  ],
);

export const resourceVolume = pgTable(
  "resource_volume",
  {
    id: text("id").primaryKey().$defaultFn(createId),
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
    id: text("id").primaryKey().$defaultFn(createId),
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

export const portMapping = pgTable(
  "port_mapping",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    port: integer("port").notNull(),
    protocol: portProtocolEnum("protocol").notNull().default("http"),
    visibility: portVisibilityEnum("visibility").notNull().default("internal"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("port_mapping_resource_idx").on(table.resourceId),
    uniqueIndex("port_mapping_resource_port_proto_uidx").on(
      table.resourceId,
      table.port,
      table.protocol,
    ),
  ],
);

export const portMappingRelations = relations(portMapping, ({ one }) => ({
  resource: one(resource, {
    fields: [portMapping.resourceId],
    references: [resource.id],
  }),
}));

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
