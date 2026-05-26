import { createId, ID_PREFIX, type Id } from "@otterstack/shared/id";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

export const projectStatusEnum = pgEnum("project_status", ["draft", "valid", "invalid"]);

type EnvId = Id<typeof ID_PREFIX.environment>;
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
    environmentId: text("environment_id").$type<EnvId>(),
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

export const environment = pgTable(
  "environment",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.environment>>()
      .$defaultFn(() => createId(ID_PREFIX.environment)),
    projectId: text("project_id")
      .$type<Id<typeof ID_PREFIX.project>>()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("environment_project_id_idx").on(table.projectId),
    uniqueIndex("environment_project_slug_unique").on(table.projectId, table.slug),
  ],
);

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
      .references(() => project.id, { onDelete: "cascade" }),
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
    // Gate for whether the public hostname is actually fronted by the
    // Caddy proxy. The hostname is always computed (deterministic from
    // name + project slug) so flipping to true later is a no-op for the
    // schema; only the proxy route registration depends on this flag.
    publicEnabled: boolean("public_enabled").notNull().default(false),
    publicHostname: text("public_hostname").notNull(),
    publicPort: integer("public_port").notNull().default(443),
    publicConnectionString: text("public_connection_string").notNull(),
    internalHostname: text("internal_hostname").notNull(),
    internalPort: integer("internal_port").notNull().default(5432),
    internalConnectionString: text("internal_connection_string").notNull(),
    upstreamHost: text("upstream_host").notNull(),
    upstreamPort: integer("upstream_port").notNull().default(5432),
    caddyLayer4Snippet: text("caddy_layer4_snippet").notNull(),
    engineConfig: jsonb("engine_config").$type<Record<string, unknown>>().notNull().default({}),
    // User-editable env vars injected into the Postgres container alongside
    // the derived POSTGRES_USER / PASSWORD / DB. Used for tuning knobs like
    // POSTGRES_INITDB_ARGS, TZ, LANG, POSTGRES_HOST_AUTH_METHOD, etc.
    // Setting or unsetting triggers a swarm task update (~5s downtime).
    extraEnv: jsonb("extra_env").$type<Record<string, string>>().notNull().default({}),
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

// Deployment — one logical "push" of a resource to swarm. Each create /
// redeploy / env-change inserts a new deployment row and tags the swarm
// spec with `otterstack.deployment.id=<id>` so the tasks docker schedules
// inherit the link via Spec.ContainerSpec.Labels. The Deployments tab in
// the UI lists these rows and expands each to show its underlying tasks.
export const deploymentStatusEnum = pgEnum("deployment_status", [
  "pending",
  "building",
  "running",
  "failed",
  "superseded",
  "removed",
]);

export const deploymentReasonEnum = pgEnum("deployment_reason", [
  "create",
  "redeploy",
  "env-change",
  "image-change",
  "restart",
]);

export const deployment = pgTable(
  "deployment",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.deployment>>()
      .$defaultFn(() => createId(ID_PREFIX.deployment)),
    resourceId: text("resource_id")
      .notNull()
      .$type<Id<typeof ID_PREFIX.resource>>()
      .references(() => resource.id, { onDelete: "cascade" }),
    // Image the deployment was launched with. Captured at insert time so
    // history survives a platform image-pin change.
    image: text("image").notNull(),
    reason: deploymentReasonEnum("reason").notNull().default("create"),
    status: deploymentStatusEnum("status").notNull().default("pending"),
    // Full configuration snapshot of the resource at deploy time. The
    // shape mirrors the resource's own columns (env, ports, healthcheck,
    // command, mounts, resources, etc.) — enough to reproduce the deploy
    // by re-applying it. "Rollback to deployment N" means: load this
    // snapshot, write its fields back onto the resource row, then run a
    // normal redeploy. The schema is intentionally untyped at the DB
    // layer (resources differ between database/service kinds) and
    // validated at the application boundary instead.
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    // Populated when the deployment finalizes (terminal status reached).
    errorMessage: text("error_message"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("deployment_resource_id_idx").on(table.resourceId),
    index("deployment_resource_created_idx").on(
      table.resourceId,
      table.createdAt,
    ),
  ],
);

export const servicePortProtocolEnum = pgEnum("service_port_protocol", ["tcp", "udp"]);
export const serviceAppProtocolEnum = pgEnum("service_app_protocol", ["http", "tcp"]);

// Mount type discriminator.
//   - volume: named docker volume managed by swarm. Source = volume name.
//   - bind:   bind-mount a path on the host into the container. Source = host path.
//   - file:   like bind, but the file's content is stored IN THIS TABLE and
//             materialized to disk under PLATFORM.files.root/<service>/<target>
//             at deploy time. Lets users author small config files (nginx.conf,
//             init.sql, etc.) from the UI without ssh'ing to a node.
export const serviceMountTypeEnum = pgEnum("service_mount_type", [
  "volume",
  "bind",
  "file",
]);

export const serviceMount = pgTable(
  "service_mount",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.serviceMount>>()
      .$defaultFn(() => createId(ID_PREFIX.serviceMount)),
    serviceResourceId: text("service_resource_id")
      .notNull()
      .$type<Id<typeof ID_PREFIX.resource>>()
      .references(() => serviceResource.resourceId, { onDelete: "cascade" }),
    type: serviceMountTypeEnum("type").notNull(),
    /** Path inside the container where the mount appears. Always set. */
    target: text("target").notNull(),
    /**
     * For type=volume → the docker volume name.
     * For type=bind   → the absolute host path being bind-mounted.
     * For type=file   → the relative path under <PLATFORM.files.root>/<service>/
     *                   where `content` is materialized; the bind target points at
     *                   that materialized file. May be left null for type=file —
     *                   the spec builder will default it to the target's basename.
     */
    source: text("source"),
    /**
     * File contents for type=file. Stored as text (utf-8). Binary blobs aren't
     * supported here — use type=bind to a pre-staged file for those.
     */
    content: text("content"),
    readOnly: boolean("read_only").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("service_mount_target_unique").on(
      table.serviceResourceId,
      table.target,
    ),
    index("service_mount_service_resource_id_idx").on(table.serviceResourceId),
  ],
);

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

// Per-service env vars, scoped to an environment. Service-only values that
// shouldn't (or can't) be promoted to the project-shared layer.
//
// Resolution order at deploy time:
//   1. projectEnvSubscription -> projectEnvVar (inherited shared values)
//   2. serviceEnvVar matching (serviceResourceId, environmentId) overlay
//   3. ${{Resource.VAR}} template expansion on values
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
    // Per-environment scoping. Same (service, key) can carry different values
    // across production / staging / preview / ad-hoc envs.
    //
    // NULLABLE in v1: existing rows pre-date the env model, and the service
    // router's setEnv / bulkSet handlers don't yet thread an envId through.
    // Step 7 of the secrets rework backfills + tightens this to NOT NULL.
    environmentId: text("environment_id")
      .$type<EnvId>()
      .references(() => environment.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    // Drives masking in the UI. Does not affect storage (plaintext for v1).
    isSecret: boolean("is_secret").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Old unique kept while environmentId is nullable. Tightens to
    // (serviceResourceId, environmentId, key) in step 7.
    uniqueIndex("service_env_var_unique").on(table.serviceResourceId, table.key),
    index("service_env_var_service_resource_id_idx").on(table.serviceResourceId),
    index("service_env_var_environment_id_idx").on(table.environmentId),
  ],
);

// Project-scoped shared env var. One row per (projectId, environmentId, key).
// Services receive these values only when they explicitly subscribe via
// projectEnvSubscription — sharing is opt-in per service.
export const projectEnvVar = pgTable(
  "project_env_var",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.projectEnvVar>>()
      .$defaultFn(() => createId(ID_PREFIX.projectEnvVar)),
    projectId: text("project_id")
      .notNull()
      .$type<Id<typeof ID_PREFIX.project>>()
      .references(() => project.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .$type<EnvId>()
      .references(() => environment.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    isSecret: boolean("is_secret").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("project_env_var_unique").on(
      table.projectId,
      table.environmentId,
      table.key,
    ),
    index("project_env_var_project_id_idx").on(table.projectId),
    index("project_env_var_environment_id_idx").on(table.environmentId),
    index("project_env_var_key_idx").on(table.projectId, table.key),
  ],
);

// Explicit subscription: this service receives this project key at runtime.
// Without a row, the service does NOT get the value — even if it exists at
// the project level. Keyed by `projectEnvKey` (not the row id) so renaming a
// project var key requires explicit re-subscription, surfacing the breakage.
export const projectEnvSubscription = pgTable(
  "project_env_subscription",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.projectEnvSubscription>>()
      .$defaultFn(() => createId(ID_PREFIX.projectEnvSubscription)),
    serviceResourceId: text("service_resource_id")
      .notNull()
      .$type<Id<typeof ID_PREFIX.resource>>()
      .references(() => serviceResource.resourceId, { onDelete: "cascade" }),
    projectEnvKey: text("project_env_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_env_subscription_unique").on(
      table.serviceResourceId,
      table.projectEnvKey,
    ),
    index("project_env_subscription_service_resource_id_idx").on(
      table.serviceResourceId,
    ),
    index("project_env_subscription_key_idx").on(table.projectEnvKey),
  ],
);
