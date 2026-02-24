# Schema Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the database schema per `2026-02-24-schema-redesign-v2.md`, updating all downstream consumers.

**Architecture:** Rewrite 9 schema files (drop god table, split into config extensions, fix FKs/enums), then update ~29 downstream files that import from schema. Since this is on `feat/zero-sync` branch (not production), we do a direct rewrite — no staged migration needed.

**Tech Stack:** Drizzle ORM, PostgreSQL, Zero (real-time sync), TypeScript

---

### Task 1: Rewrite `enums.ts` — drop 3 enums

**Files:**
- Modify: `packages/db/src/schema/enums.ts`

**Step 1: Rewrite enums.ts**

Drop: `buildMethodEnum`, `envVarScopeEnum`, `resourceLinkTypeEnum` (referenced nowhere after schema rewrite).
Keep all other 14 enums unchanged.

```ts
import { pgEnum } from "drizzle-orm/pg-core";

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "queued",
  "building",
  "deploying",
  "verifying",
  "live",
  "failed",
  "canceled",
  "rolled_back",
]);

export const deploymentSourceEnum = pgEnum("deployment_source", [
  "git_push",
  "manual",
  "rollback",
  "api",
  "preview",
  "config_change",
]);

export const builderEnum = pgEnum("builder", [
  "nixpacks",
  "dockerfile",
  "buildpack",
  "railpack",
]);

export const restartPolicyEnum = pgEnum("restart_policy", [
  "ON_FAILURE",
  "ALWAYS",
  "NEVER",
]);

export const sslStatusEnum = pgEnum("ssl_status", [
  "pending",
  "active",
  "failed",
  "expired",
]);

export const serverStatusEnum = pgEnum("server_status", [
  "connected",
  "disconnected",
  "provisioning",
  "error",
]);

export const serverRoleEnum = pgEnum("server_role", [
  "manager",
  "worker",
]);

export const backupStatusEnum = pgEnum("backup_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const databaseTypeEnum = pgEnum("database_type", [
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "keydb",
  "dragonfly",
  "clickhouse",
]);

export const secretProviderEnum = pgEnum("secret_provider", [
  "infisical",
  "native_breakglass",
]);

export const secretKindEnum = pgEnum("secret_kind", [
  "env_var",
  "ssh_private_key",
  "git_client_secret",
  "git_webhook_secret",
]);

export const secretLogicalScopeEnum = pgEnum("secret_logical_scope", [
  "organization",
  "project",
  "environment",
  "resource",
]);

export const secretProviderBindingStatusEnum = pgEnum("secret_provider_binding_status", [
  "provisioning",
  "active",
  "error",
]);

export const caddyStatusEnum = pgEnum("caddy_status", [
  "not_installed",
  "initializing",
  "running",
  "stopped",
  "error",
]);

export const resourceKindEnum = pgEnum("resource_kind", [
  "web",
  "api",
  "worker",
  "database",
  "cache",
  "volume",
  "compose",
]);

export const resourceStatusEnum = pgEnum("resource_status", [
  "online",
  "degraded",
  "crashed",
  "deploying",
  "stopped",
  "unknown",
]);
```

**Step 2: Verify no broken imports**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterstack && bunx tsc --noEmit -p packages/db/tsconfig.json 2>&1 | head -30`

This will fail (other files still import old enums) — that's expected, we fix consumers in later tasks.

**Step 3: Commit**

```bash
git add packages/db/src/schema/enums.ts
git commit -m "refactor(schema): drop buildMethod, envVarScope, resourceLinkType enums"
```

---

### Task 2: Rewrite `architecture.ts` → `project.ts`

**Files:**
- Delete: `packages/db/src/schema/architecture.ts`
- Create: `packages/db/src/schema/project.ts`

**Step 1: Create `project.ts` with thin resource table + position/viewport**

This file contains: `project`, `environment`, `resource`, `resourcePosition`, `viewport` and all their relations.

Key changes from old `architecture.ts`:
- `projectEnvironment` → `environment`
- `projectResource` (30+ cols) → `resource` (~10 cols, identity only)
- `projectResourceLink` → DROPPED
- `projectViewport` → `viewport`
- `databaseConfig` → moved to `resource-config.ts` (Task 3)
- `resource` gets `organizationId` and `projectId` directly (denormalized for query perf)
- `resource` gets proper FK for `serverId`
- `posX`/`posY` → separate `resourcePosition` table
- All `metadata` jsonb bags removed
- `resourceKindEnum` and `resourceStatusEnum` moved to `enums.ts` (done in Task 1)

Write the complete file. Import `organization`, `user` from `./auth`, import `server` from `./infrastructure` (forward ref — Drizzle handles circular refs via relations). Import enums from `./enums`.

```ts
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

// Forward reference — server is defined in infrastructure.ts
// Drizzle relations handle this; the FK is declared inline without .references()
// and enforced via a migration-level constraint.

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

export const resourceRelations = relations(resource, ({ one }) => ({
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
```

**Step 2: Delete old architecture.ts**

```bash
rm packages/db/src/schema/architecture.ts
```

**Step 3: Commit**

```bash
git add packages/db/src/schema/project.ts
git add packages/db/src/schema/architecture.ts
git commit -m "refactor(schema): replace architecture.ts with project.ts — thin resource table"
```

---

### Task 3: Create `resource-config.ts` — all 6 config extension tables

**Files:**
- Create: `packages/db/src/schema/resource-config.ts`

**Step 1: Write the file**

Contains: `resourceRuntimeConfig`, `resourceBuildConfig`, `resourceJobConfig`, `resourceComposeConfig`, `databaseConfig`, `volumeConfig` + all their relations.

```ts
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

export const volumeConfig = pgTable(
  "volume_config",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => resource.id, { onDelete: "cascade" }),
    mountPath: text("mount_path").notNull(),
    sizeGb: integer("size_gb"),
    driver: text("driver").default("local"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("volume_config_resource_idx").on(table.resourceId)],
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

export const volumeConfigRelations = relations(volumeConfig, ({ one }) => ({
  resource: one(resource, {
    fields: [volumeConfig.resourceId],
    references: [resource.id],
  }),
}));
```

**Step 2: Commit**

```bash
git add packages/db/src/schema/resource-config.ts
git commit -m "feat(schema): add resource config extension tables (runtime, build, job, compose, database, volume)"
```

---

### Task 4: Rewrite `infrastructure.ts` — fix FKs, drop dual secrets, drop metadata

**Files:**
- Modify: `packages/db/src/schema/infrastructure.ts`

**Step 1: Rewrite the file**

Key changes:
- `server`: remove `metadata` jsonb, remove `acmeEmail` (moved to caddy_instance)
- `sshKey`: remove `encryptedPrivateKey`, add `updatedAt`
- `gitProvider`: remove `encryptedClientSecret`, `encryptedWebhookSecret`
- `gitRepository`: no structural changes, update import from `./project` instead of `./architecture`
- All imports updated: `projectResource` → `resource`, import from `./project`

```ts
import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { resource } from "./project";
import { secretReference } from "./secrets";
import { serverStatusEnum, serverRoleEnum } from "./enums";

export const sshKey = pgTable(
  "ssh_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    publicKey: text("public_key").notNull(),
    privateKeySecretReferenceId: text("private_key_secret_reference_id").references(
      () => secretReference.id,
      { onDelete: "set null" },
    ),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("ssh_key_org_idx").on(table.organizationId),
    index("ssh_key_secret_ref_idx").on(table.privateKeySecretReferenceId),
  ],
);

export const server = pgTable(
  "server",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ipAddress: text("ip_address").notNull(),
    port: integer("port").notNull().default(22),
    sshKeyId: text("ssh_key_id").references(() => sshKey.id, {
      onDelete: "set null",
    }),
    status: serverStatusEnum("status").notNull().default("disconnected"),
    role: serverRoleEnum("role").notNull().default("worker"),
    dockerVersion: text("docker_version"),
    os: text("os"),
    arch: text("arch"),
    totalMemory: bigint("total_memory", { mode: "number" }),
    totalCpu: integer("total_cpu"),
    totalDisk: bigint("total_disk", { mode: "number" }),
    swarmNodeId: text("swarm_node_id"),
    baseDomain: text("base_domain"),
    dockerCleanupThreshold: integer("docker_cleanup_threshold").default(80),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("server_org_idx").on(table.organizationId)],
);

export const gitProvider = pgTable(
  "git_provider",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    appId: text("app_id"),
    clientId: text("client_id"),
    clientSecretReferenceId: text("client_secret_reference_id").references(
      () => secretReference.id,
      { onDelete: "set null" },
    ),
    installationId: text("installation_id"),
    webhookSecretReferenceId: text("webhook_secret_reference_id").references(
      () => secretReference.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("git_provider_org_idx").on(table.organizationId),
    index("git_provider_client_secret_ref_idx").on(table.clientSecretReferenceId),
    index("git_provider_webhook_secret_ref_idx").on(table.webhookSecretReferenceId),
  ],
);

export const gitRepository = pgTable(
  "git_repository",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    gitProviderId: text("git_provider_id")
      .notNull()
      .references(() => gitProvider.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    branch: text("branch").notNull().default("main"),
    rootDirectory: text("root_directory").default("/"),
    autoDeploy: boolean("auto_deploy").notNull().default(true),
    webhookId: text("webhook_id"),
    watchPaths: text("watch_paths").array(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("git_repo_resource_idx").on(table.resourceId)],
);

// --- Relations ---

export const sshKeyRelations = relations(sshKey, ({ one }) => ({
  organization: one(organization, {
    fields: [sshKey.organizationId],
    references: [organization.id],
  }),
}));

export const serverRelations = relations(server, ({ one }) => ({
  organization: one(organization, {
    fields: [server.organizationId],
    references: [organization.id],
  }),
  sshKey: one(sshKey, {
    fields: [server.sshKeyId],
    references: [sshKey.id],
  }),
}));

export const gitProviderRelations = relations(gitProvider, ({ one, many }) => ({
  organization: one(organization, {
    fields: [gitProvider.organizationId],
    references: [organization.id],
  }),
  repositories: many(gitRepository),
}));

export const gitRepositoryRelations = relations(gitRepository, ({ one }) => ({
  resource: one(resource, {
    fields: [gitRepository.resourceId],
    references: [resource.id],
  }),
  provider: one(gitProvider, {
    fields: [gitRepository.gitProviderId],
    references: [gitProvider.id],
  }),
}));
```

**Step 2: Commit**

```bash
git add packages/db/src/schema/infrastructure.ts
git commit -m "refactor(schema): clean infrastructure tables — drop dual secrets, metadata bags"
```

---

### Task 5: Rewrite `deployment.ts` — fix FKs, drop metadata, use builder enum

**Files:**
- Modify: `packages/db/src/schema/deployment.ts`

**Step 1: Rewrite the file**

Key changes:
- Import from `./project` instead of `./architecture`
- `deployment`: add proper FK on `triggeredBy`, add `idempotencyKey`, drop `metadata`, replace `buildMethod` with `builder`
- `deploymentEvent`: unchanged (metadata is acceptable for polymorphic events)
- Update relation names: `projectEnvironment` → `environment`, `projectResource` → `resource`

```ts
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project, environment, resource } from "./project";
import { deploymentStatusEnum, deploymentSourceEnum, builderEnum } from "./enums";

export const deployment = pgTable(
  "deployment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    status: deploymentStatusEnum("status").notNull().default("queued"),
    source: deploymentSourceEnum("source").notNull().default("manual"),
    gitRef: text("git_ref"),
    gitCommitSha: text("git_commit_sha"),
    gitCommitMessage: text("git_commit_message"),
    builder: builderEnum("builder"),
    imageTag: text("image_tag"),
    previousImageTag: text("previous_image_tag"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    duration: integer("duration"),
    triggeredBy: text("triggered_by").references(() => user.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("deployment_org_idx").on(table.organizationId),
    index("deployment_project_idx").on(table.projectId),
    index("deployment_resource_idx").on(table.resourceId),
    index("deployment_status_idx").on(table.status),
    index("deployment_created_idx").on(table.createdAt),
  ],
);

export const deploymentEvent = pgTable(
  "deployment_event",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployment.id, { onDelete: "cascade" }),
    status: deploymentStatusEnum("status").notNull(),
    previousStatus: deploymentStatusEnum("previous_status"),
    actor: text("actor"),
    reason: text("reason"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("deployment_event_deployment_idx").on(table.deploymentId),
    index("deployment_event_created_idx").on(table.createdAt),
  ],
);

// --- Relations ---

export const deploymentRelations = relations(deployment, ({ one, many }) => ({
  project: one(project, {
    fields: [deployment.projectId],
    references: [project.id],
  }),
  environment: one(environment, {
    fields: [deployment.environmentId],
    references: [environment.id],
  }),
  resource: one(resource, {
    fields: [deployment.resourceId],
    references: [resource.id],
  }),
  triggeredByUser: one(user, {
    fields: [deployment.triggeredBy],
    references: [user.id],
  }),
  events: many(deploymentEvent),
}));

export const deploymentEventRelations = relations(
  deploymentEvent,
  ({ one }) => ({
    deployment: one(deployment, {
      fields: [deploymentEvent.deploymentId],
      references: [deployment.id],
    }),
  }),
);
```

**Step 2: Commit**

```bash
git add packages/db/src/schema/deployment.ts
git commit -m "refactor(schema): clean deployment tables — fix FKs, add idempotency key, drop metadata"
```

---

### Task 6: Rewrite `operations.ts` — fix env var scope, drop metadata, fix FKs

**Files:**
- Modify: `packages/db/src/schema/operations.ts`

**Step 1: Rewrite the file**

Key changes:
- `customDomain`: update import from `./project`
- `environmentVariable`: replace `scope + scopeId` with explicit nullable FK columns + CHECK comment
- `backup`: drop `metadata` jsonb
- `auditLog`: add proper FKs with SET NULL
- `notificationChannel`: unchanged
- All imports: `projectResource` → `resource`, `projectEnvironment` → `environment`, from `./project`

```ts
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
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
    id: text("id").primaryKey(),
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
    id: text("id").primaryKey(),
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
    // CHECK: exactly one of (project_id, environment_id, resource_id) IS NOT NULL
    // Applied via migration SQL since Drizzle doesn't natively support multi-column check constraints well
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
    id: text("id").primaryKey(),
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
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
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
```

**Step 2: Commit**

```bash
git add packages/db/src/schema/operations.ts
git commit -m "refactor(schema): redesign env vars (explicit scope FKs), fix audit log FKs, drop metadata bags"
```

---

### Task 7: Rewrite `secrets.ts` — update imports, drop organizationId from snapshot

**Files:**
- Modify: `packages/db/src/schema/secrets.ts`

**Step 1: Rewrite**

Key changes:
- Import `resource` from `./project` instead of `projectResource` from `./architecture`
- Import `environment` from `./project` instead of `projectEnvironment` from `./architecture`
- `secretProviderBinding` and `secretReference`: unchanged
- `deploymentSecretSnapshot`: keep `organizationId` per v2 decision

```ts
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
import { resource } from "./project";
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
      .references(() => resource.id, { onDelete: "cascade" }),
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

// --- Relations ---

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
    resource: one(resource, {
      fields: [deploymentSecretSnapshot.resourceId],
      references: [resource.id],
    }),
  }),
);
```

**Step 2: Commit**

```bash
git add packages/db/src/schema/secrets.ts
git commit -m "refactor(schema): update secrets imports to new project.ts tables"
```

---

### Task 8: Rewrite `metrics.ts` — update imports, drop metadata from caddy

**Files:**
- Modify: `packages/db/src/schema/metrics.ts`

**Step 1: Rewrite**

Key changes:
- Import `resource` from `./project` instead of `projectResource` from `./architecture`
- `caddyInstance`: remove `organizationId` (derivable from server → org), remove `metadata` jsonb, add `acmeEmail` (moved from server)
- `backupSchedule`: update imports
- Other tables: update import paths only

```ts
import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { resource } from "./project";
import { server } from "./infrastructure";
import { secretReference } from "./secrets";
import { caddyStatusEnum } from "./enums";

export const resourceMetric = pgTable(
  "resource_metric",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
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

export const resourceMetricHourly = pgTable(
  "resource_metric_hourly",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
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
    passwordSecretRefId: text("password_secret_ref_id").references(
      () => secretReference.id,
      { onDelete: "set null" },
    ),
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

export const configFile = pgTable(
  "config_file",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
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

export const scheduledTaskExecution = pgTable(
  "scheduled_task_execution",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
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

export const caddyInstance = pgTable(
  "caddy_instance",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .notNull()
      .references(() => server.id, { onDelete: "cascade" }),
    status: caddyStatusEnum("caddy_status").notNull().default("not_installed"),
    version: text("version"),
    acmeEmail: text("acme_email"),
    lastHealthCheckAt: timestamp("last_health_check_at"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("caddy_instance_server_idx").on(table.serverId),
  ],
);

export const backupSchedule = pgTable(
  "backup_schedule",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
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

// --- Relations ---

export const resourceMetricRelations = relations(resourceMetric, ({ one }) => ({
  resource: one(resource, {
    fields: [resourceMetric.resourceId],
    references: [resource.id],
  }),
}));

export const containerRegistryRelations = relations(containerRegistry, ({ one }) => ({
  organization: one(organization, {
    fields: [containerRegistry.organizationId],
    references: [organization.id],
  }),
}));

export const configFileRelations = relations(configFile, ({ one }) => ({
  resource: one(resource, {
    fields: [configFile.resourceId],
    references: [resource.id],
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
}));

export const backupScheduleRelations = relations(backupSchedule, ({ one }) => ({
  resource: one(resource, {
    fields: [backupSchedule.resourceId],
    references: [resource.id],
  }),
  organization: one(organization, {
    fields: [backupSchedule.organizationId],
    references: [organization.id],
  }),
}));
```

**Step 2: Commit**

```bash
git add packages/db/src/schema/metrics.ts
git commit -m "refactor(schema): update metrics/ops tables — caddy drops orgId/metadata, registry gets secret FK"
```

---

### Task 9: Update `index.ts` — new exports

**Files:**
- Modify: `packages/db/src/schema/index.ts`

**Step 1: Rewrite**

```ts
export * from "./auth";
export * from "./project";
export * from "./resource-config";
export * from "./enums";
export * from "./deployment";
export * from "./infrastructure";
export * from "./operations";
export * from "./secrets";
export * from "./metrics";
```

**Step 2: Commit**

```bash
git add packages/db/src/schema/index.ts
git commit -m "refactor(schema): update barrel exports — architecture → project, add resource-config"
```

---

### Task 10: Update all downstream consumers — domain layer

**Files (13 files):**
- Modify: `packages/domain/src/architecture.ts`
- Modify: `packages/domain/src/environment.ts`
- Modify: `packages/domain/src/project.ts`
- Delete: `packages/domain/src/resource-link.ts`
- Modify: `packages/domain/src/deployment.ts`
- Modify: `packages/domain/src/deployment-machine.ts`
- Modify: `packages/domain/src/deployment-secret.ts`
- Modify: `packages/domain/src/server-management.ts`
- Modify: `packages/domain/src/git-provider.ts`
- Modify: `packages/domain/src/environment-variable.ts`
- Modify: `packages/domain/src/custom-domain.ts`
- Modify: `packages/domain/src/backup.ts`
- Modify: `packages/domain/src/monitoring.ts`

**Step 1: For each file, apply these import renames:**

| Old import | New import | From |
|---|---|---|
| `projectResource` | `resource` | `@otterdeploy/db/schema/project` |
| `projectEnvironment` | `environment` | `@otterdeploy/db/schema/project` |
| `projectResourceLink` | REMOVED | — |
| `projectViewport` | `viewport` | `@otterdeploy/db/schema/project` |
| `from "...schema/architecture"` | `from "...schema/project"` | — |
| `buildMethodEnum` | REMOVED (use `builderEnum`) | — |
| `envVarScopeEnum` | REMOVED | — |

For `resource-link.ts`: Delete the file entirely (table dropped).

For `environment-variable.ts`: Update to use the new explicit scope FK columns instead of `scope` + `scopeId`.

**NOTE:** Each file needs to be read first to understand the exact usage, then updated. The agent executing this task should read each file, identify all references to old table/column names, and update them.

**Step 2: Commit**

```bash
git add packages/domain/src/
git commit -m "refactor(domain): update all imports for schema redesign — resource table renames"
```

---

### Task 11: Update downstream consumers — API layer

**Files (4 files):**
- Modify: `packages/api/src/routers/resource.ts`
- Modify: `packages/api/src/utils/ownership.ts`
- Modify: `packages/api/src/utils/audit.ts`
- Modify: `packages/api/src/index.ts` (if needed)

**Step 1: Apply same import renames as Task 10**

For `ownership.ts`: Remove `projectResourceLink` import and any ownership check referencing it.

**Step 2: Commit**

```bash
git add packages/api/src/
git commit -m "refactor(api): update imports for schema redesign"
```

---

### Task 12: Update downstream consumers — worker, infra-config, secrets

**Files (5 files):**
- Modify: `apps/worker/src/functions/pipeline-deps.ts`
- Modify: `apps/worker/src/functions/ssl-monitor.ts`
- Modify: `packages/infra-config/src/reconciler.ts`
- Modify: `packages/infra-config/src/state.ts`
- Modify: `packages/secrets/src/backfill.ts`
- Modify: `packages/secrets/src/cutover-check.ts`

**Step 1: Apply same import renames**

For `state.ts`: Remove `projectResourceLink` import and any state resolution referencing it.

**Step 2: Commit**

```bash
git add apps/worker/ packages/infra-config/ packages/secrets/
git commit -m "refactor(worker,infra,secrets): update imports for schema redesign"
```

---

### Task 13: Update seed file

**Files:**
- Modify: `packages/db/src/seed.ts`

**Step 1: Update table references**

- `projectEnvironment` → `environment`
- `projectViewport` → `viewport`
- `projectResource` → `resource`
- Remove any references to `projectResourceLink`
- Import from `./schema/project` instead of `./schema/architecture`

**Step 2: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "refactor(db): update seed file for schema redesign"
```

---

### Task 14: Update Zero queries and regenerate schema

**Files:**
- Modify: `packages/zero/src/queries.ts`
- Regenerate: `packages/zero/src/schema.ts` (auto-generated)

**Step 1: Update queries.ts**

Rename all table references:
- `projectResource` → `resource`
- `projectEnvironment` → `environment`
- `projectResourceLink` → REMOVE all queries referencing this
- `projectViewport` → `viewport`

**Step 2: Regenerate Zero schema**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterstack && bun run --filter @otterdeploy/zero generate` (or whatever the generate command is)

**Step 3: Commit**

```bash
git add packages/zero/
git commit -m "refactor(zero): update queries and regenerate schema for redesign"
```

---

### Task 15: Update contract layer

**Files:**
- Modify: `packages/contract/src/contracts/resource-link.ts` — delete or gut
- Modify: `packages/contract/src/contracts/architecture.ts` — remove ResourceLinkTypeSchema
- Possibly modify other contract files referencing old schema names

**Step 1: Read each contract file and update**

Remove `ResourceLinkSchema`, `ResourceLinkTypeSchema`, `GraphEdgeSchema` (if tied to resource links).
Update any schema references that map to renamed tables.

**Step 2: Commit**

```bash
git add packages/contract/
git commit -m "refactor(contract): remove resource link contracts, update schema references"
```

---

### Task 16: Type check and fix remaining errors

**Step 1: Run full type check**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterstack && bun run typecheck 2>&1 | head -100`

**Step 2: Fix any remaining type errors**

These will likely be:
- Missed import renames
- Column references to removed fields (e.g. `projectResource.buildMethod`)
- Missing config table joins where code used to read from the god table

**Step 3: Iterate until clean**

Run typecheck again until 0 errors.

**Step 4: Commit**

```bash
git add .
git commit -m "fix: resolve all type errors from schema redesign"
```

---

### Task 17: Generate migration and verify

**Step 1: Generate Drizzle migration**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterstack && bun run db:generate`

**Step 2: Review the generated SQL**

Read the generated migration file and verify it:
- Creates new tables (resource_runtime_config, resource_build_config, etc.)
- Drops old tables (project_resource_link)
- Renames tables where appropriate
- Adds new constraints (CHECK on environment_variable)

**Step 3: Commit**

```bash
git add packages/db/src/migrations/
git commit -m "chore(db): generate migration for schema redesign"
```
