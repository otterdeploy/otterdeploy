import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId, ID_PREFIX, type Id } from "@otterstack/shared/id";
import { organization, user } from "./auth";

export const projectStatusEnum = pgEnum("project_status", ["draft", "valid", "invalid"]);

export const project = pgTable(
  "project",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.project>>()
      .$defaultFn(() => createId(ID_PREFIX.project)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    environmentId: text("environment_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("project_slug_idx").on(table.slug),
    index("project_organization_id_idx").on(table.organizationId),
  ],
);

export const teamMember = pgTable(
  "team_member",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("team_member_team_id_idx").on(table.teamId),
    index("team_member_user_id_idx").on(table.userId),
  ],
);

export const environment = pgTable("environment", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId(ID_PREFIX.environment)),

  projectId: text("project_id")
    .notNull()
    .references(() => project.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

// service
// database
export const resourceTypeEnum = pgEnum("resource_type", ["database", "service"]);
export const resourceStatusEnum = pgEnum("resource_status", ["draft", "valid", "invalid"]);
export const resource = pgTable(
  "resource",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.resource>>()
      .$defaultFn(() => createId(ID_PREFIX.resource)),
    projectId: text("project_id")
      .notNull()
      .$type<Id<typeof ID_PREFIX.project>>()
      .references(() => project.id),
    name: text("name").notNull(),
    type: resourceTypeEnum("type").notNull(),
    status: resourceStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("resource_project_name_unique").on(table.projectId, table.name),
    index("resource_project_id_idx").on(table.projectId),
  ],
);

export const databaseEngineEnum = pgEnum("database_engine", ["postgres"]);

export const databaseResource = pgTable(
  "database_resource",
  {
    resourceId: text("resource_id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.resource>>()
      .references(() => resource.id, { onDelete: "cascade" }),
    engine: databaseEngineEnum("engine").notNull().default("postgres"),
    databaseName: text("database_name").notNull(),
    username: text("username").notNull(),
    password: text("password").notNull(),
    publicHostname: text("public_hostname").notNull(),
    publicPort: integer("public_port").notNull().default(443),
    publicConnectionString: text("public_connection_string").notNull(),
    internalHostname: text("internal_hostname").notNull(),
    internalPort: integer("internal_port").notNull().default(5432),
    internalConnectionString: text("internal_connection_string").notNull(),
    upstreamHost: text("upstream_host").notNull(),
    upstreamPort: integer("upstream_port").notNull().default(5432),
    caddyLayer4Snippet: text("caddy_layer4_snippet").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("database_resource_database_name_unique").on(table.databaseName),
    uniqueIndex("database_resource_username_unique").on(table.username),
    uniqueIndex("database_resource_public_hostname_unique").on(table.publicHostname),
    uniqueIndex("database_resource_internal_hostname_unique").on(table.internalHostname),
  ],
);

export const serviceRestartConditionEnum = pgEnum("service_restart_condition", [
  "none",
  "on-failure",
  "any",
]);

export const serviceResource = pgTable(
  "service_resource",
  {
    resourceId: text("resource_id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.resource>>()
      .references(() => resource.id, { onDelete: "cascade" }),

    image: text("image").notNull(),
    imageDigest: text("image_digest"),
    command: text("command").array(),
    entrypoint: text("entrypoint").array(),

    replicas: integer("replicas").notNull().default(1),

    restartCondition: serviceRestartConditionEnum("restart_condition")
      .notNull()
      .default("on-failure"),
    restartMaxAttempts: integer("restart_max_attempts"),
    restartDelayMs: integer("restart_delay_ms").notNull().default(5000),

    healthcheckCmd: text("healthcheck_cmd").array(),
    healthcheckIntervalMs: integer("healthcheck_interval_ms"),
    healthcheckTimeoutMs: integer("healthcheck_timeout_ms"),
    healthcheckRetries: integer("healthcheck_retries"),
    healthcheckStartMs: integer("healthcheck_start_ms"),

    cpuLimit: numeric("cpu_limit", { precision: 4, scale: 2 }),
    memoryLimitMb: integer("memory_limit_mb"),
    cpuReservation: numeric("cpu_reservation", { precision: 4, scale: 2 }),
    memoryReservationMb: integer("memory_reservation_mb"),

    internalHostname: text("internal_hostname").notNull(),
    serviceName: text("service_name").notNull(),
    networkName: text("network_name").notNull(),

    publicEnabled: boolean("public_enabled").notNull().default(false),
    publicDomain: text("public_domain"),

    forceUpdateCounter: integer("force_update_counter").notNull().default(0),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("service_resource_service_name_unique").on(table.serviceName),
    uniqueIndex("service_resource_internal_hostname_unique").on(table.internalHostname),
    uniqueIndex("service_resource_public_domain_unique").on(table.publicDomain),
  ],
);

export const servicePortProtocolEnum = pgEnum("service_port_protocol", ["tcp", "udp"]);
export const serviceAppProtocolEnum = pgEnum("service_app_protocol", ["http", "tcp"]);

export const servicePort = pgTable(
  "service_port",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.servicePort>>()
      .$defaultFn(() => createId(ID_PREFIX.servicePort)),
    serviceResourceId: text("service_resource_id")
      .notNull()
      .$type<Id<typeof ID_PREFIX.resource>>()
      .references(() => serviceResource.resourceId, { onDelete: "cascade" }),
    containerPort: integer("container_port").notNull(),
    protocol: servicePortProtocolEnum("protocol").notNull().default("tcp"),
    appProtocol: serviceAppProtocolEnum("app_protocol").notNull().default("http"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("service_port_unique").on(
      table.serviceResourceId,
      table.containerPort,
      table.protocol,
    ),
    index("service_port_service_resource_id_idx").on(table.serviceResourceId),
  ],
);

export const serviceEnvVar = pgTable(
  "service_env_var",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.serviceEnvVar>>()
      .$defaultFn(() => createId(ID_PREFIX.serviceEnvVar)),
    serviceResourceId: text("service_resource_id")
      .notNull()
      .$type<Id<typeof ID_PREFIX.resource>>()
      .references(() => serviceResource.resourceId, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("service_env_var_unique").on(table.serviceResourceId, table.key),
    index("service_env_var_service_resource_id_idx").on(table.serviceResourceId),
  ],
);
