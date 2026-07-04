import type { BuildConfig } from "@otterdeploy/shared/build-config";
import type { ComposeExposed, ComposeServiceSummary } from "@otterdeploy/shared/compose";
import type { FrameworkKind } from "@otterdeploy/shared/framework";
import type {
  DeploymentId,
  EnvironmentId,
  GitRepoId,
  ProjectEnvSubscriptionId,
  ProjectEnvVarId,
  ProjectId,
  ResourceId,
  ServiceEnvVarId,
  ServiceMountId,
  ServicePortId,
} from "@otterdeploy/shared/id";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const projectStatusEnum = pgEnum("project_status", ["draft", "valid", "invalid"]);

type EnvId = EnvironmentId;

/**
 * User-supplied overrides for `nixpacks build`. Mirrors the subset of the
 * Nixpacks CLI surface we expose in the UI; runtime values get translated
 * to CLI args by the builder.
 *
 *  - `buildCmd` / `startCmd`: override Nixpacks' auto-detected commands
 *  - `packages`: extra Nix packages to install
 *  - `aptPackages`: extra apt packages (Debian-based default base image)
 *  - `installCmd`: override the install phase
 *  - `env`: build-time env vars (separate from runtime — those live on
 *    the service resource)
 */
export interface NixpacksConfig {
  buildCmd?: string;
  startCmd?: string;
  installCmd?: string;
  packages?: string[];
  aptPackages?: string[];
  env?: Record<string, string>;
}

export const project = pgTable(
  "project",
  {
    id: text("id")
      .primaryKey()
      .$type<ProjectId>()
      .$defaultFn(() => createId(ID_PREFIX.project)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Slug is unique per organization, not globally — two orgs can each have
    // a project named "web". Enforced by the (organization_id, slug) unique
    // index below.
    slug: text("slug").notNull(),
    environmentId: text("environment_id").$type<EnvId>(),
    // Declarative stack file (compose-compatible YAML with x-otterdeploy
    // extensions). Source of truth migration — Phase 1 ships the column
    // empty; subsequent phases populate + apply it. `stackFileVersion` is
    // a monotonic counter used for optimistic locking on writes.
    stackFile: text("stack_file"),
    stackFileVersion: integer("stack_file_version").notNull().default(0),
    lastAppliedFile: text("last_applied_file"),
    lastAppliedAt: timestamp("last_applied_at"),
    // JSON-native declarative manifest — CLI-facing source of truth.
    // Lives alongside `stackFile` while the compose-shaped storage is
    // phased out; the renderer can still emit compose from this column.
    // `manifestVersion` is a monotonic counter for optimistic locking on
    // writes (separate from stackFileVersion so a YAML edit and a JSON
    // edit don't accidentally race).
    manifest: jsonb("manifest").$type<Record<string, unknown> | null>(),
    manifestVersion: integer("manifest_version").notNull().default(0),
    lastAppliedManifest: jsonb("last_applied_manifest").$type<Record<string, unknown> | null>(),
    lastManifestAppliedAt: timestamp("last_manifest_applied_at"),
    // Per-project domain override. When set + verified, this project's
    // resources land under it instead of the org's baseDomain — e.g. a
    // service `web` lands at `web.<customDomain>` (no project slug, since
    // the apex IS the project). Falls through to org.baseDomain when null.
    customDomain: text("custom_domain"),
    customDomainVerifiedAt: timestamp("custom_domain_verified_at"),
    customDomainVerifyToken: text("custom_domain_verify_token"),
    // Operator-authored Caddy config (standalone site blocks / snippets)
    // appended to this project's generated fragment. Lets users define whole
    // custom sites, redirects, or reusable snippets alongside the auto-managed
    // routes. Validated together with the project's generated blocks via Caddy
    // /adapt on save + every reconcile — invalid config skips just this project
    // (the rest of the edge keeps serving). Null = none. See buildCaddyfile /
    // buildProjectFragment.
    customCaddyConfig: text("custom_caddy_config"),
    // Git source + image target moved to the SERVICE (service_resource) — each
    // git service owns its own repo/branch/image now, so two services in one
    // project can build from two different repos. The project no longer carries
    // a repo binding. See docs/designs (per-service source) + service_resource.
    nixpacksConfig: jsonb("nixpacks_config").$type<NixpacksConfig | null>().default(null),
    // Operator-arranged graph layout: node id (`${kind}:${name}`) → {x,y}.
    // Keyed by node id (not resourceId) so a position set on a pending node
    // carries over when the resource lands — the id is stable across that
    // handover. Shared per project; nodes with no saved position fall back to
    // dagre auto-layout. Written by `project.saveGraphLayout`.
    graphLayout: jsonb("graph_layout")
      .$type<Record<string, { x: number; y: number }>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("project_org_slug_unique").on(table.organizationId, table.slug),
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

// Persistent = operator-managed, long-lived (production / staging). Preview =
// ephemeral, one per open PR, machine-managed + auto-torn-down. See
// docs/designs/pr-previews.md.
export const environmentKindEnum = pgEnum("environment_kind", ["persistent", "preview"]);
export const environmentStateEnum = pgEnum("environment_state", ["active", "closed"]);

export const environment = pgTable(
  "environment",
  {
    id: text("id")
      .primaryKey()
      .$type<EnvironmentId>()
      .$defaultFn(() => createId(ID_PREFIX.environment)),
    projectId: text("project_id")
      .$type<ProjectId>()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: environmentKindEnum("kind").notNull().default("persistent"),
    state: environmentStateEnum("state").notNull().default("active"),
    // A preview env inherits its base env's vars by reference, so a change to a
    // base (production) var propagates to open previews unless overridden. Points
    // at the project's persistent env. Self-referential FK enforced app-side
    // (mirrors the cross-schema idiom on project.gitRepoId) — avoids the
    // const-before-use dance and keeps parity with the rest of the schema.
    baseEnvironmentId: text("base_environment_id").$type<EnvId>(),
    // Preview provenance — only populated when kind='preview'. gitRepoId FK
    // enforced app-side to avoid a cross-schema import cycle (see git.ts).
    gitRepoId: text("git_repo_id").$type<GitRepoId>(),
    gitRef: text("git_ref"),
    pullRequestNumber: integer("pull_request_number"),
    pullRequestNodeId: text("pull_request_node_id"),
    headSha: text("head_sha"),
    // Idle GC: tear a preview down past this instant even if the PR stays open.
    autoTeardownAt: timestamp("auto_teardown_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("environment_project_id_idx").on(table.projectId),
    uniqueIndex("environment_project_slug_unique").on(table.projectId, table.slug),
    // A (repo, PR) maps to at most one preview env. Now that a project can host
    // services from multiple repos, the key includes gitRepoId — otherwise
    // repo-A PR#5 and repo-B PR#5 in the same project would collide onto one
    // env row. Persistent envs have NULL PR number + NULL gitRepoId and NULLs
    // are distinct in a unique index, so they never collide. Preview slugs are
    // repo-qualified (`<repoSlug>-pr-<n>`) to match — see git/preview-env.ts.
    uniqueIndex("environment_project_repo_pr_unique").on(
      table.projectId,
      table.gitRepoId,
      table.pullRequestNumber,
    ),
  ],
);

// service
// database
export const resourceTypeEnum = pgEnum("resource_type", [
  "database",
  "service",
  // A Docker Compose stack: one resource that fans out to N swarm services.
  // Config lives in `compose_resource`. See docs/designs/compose.md.
  "compose",
]);
export const resourceStatusEnum = pgEnum("resource_status", ["draft", "valid", "invalid"]);
export const resource = pgTable(
  "resource",
  {
    id: text("id")
      .primaryKey()
      .$type<ResourceId>()
      .$defaultFn(() => createId(ID_PREFIX.resource)),
    projectId: text("project_id")
      .notNull()
      .$type<ProjectId>()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: resourceTypeEnum("type").notNull(),
    status: resourceStatusEnum("status").notNull().default("draft"),
    // Environment scoping. NULL = base resource (applies to every environment,
    // the only kind that exists pre-previews); set = env-specific instance such
    // as a preview DB branch. The variable resolver prefers the env-specific
    // row and falls back to the base. See docs/designs/pr-previews.md.
    environmentId: text("environment_id").$type<EnvId>(),
    // Provenance for a branched resource (e.g. a COW db branch). Self-referential
    // FK enforced app-side (same idiom as project.gitRepoId).
    branchedFromResourceId: text("branched_from_resource_id").$type<ResourceId>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // A base resource (environmentId IS NULL) is unique per (project, name).
    // An env-scoped branch shares its source's name but carries a non-null
    // environmentId, so it's uniqued per (project, environment, name) instead.
    // Two partial uniques keep base uniqueness intact while letting a preview
    // env own a branch that reuses the base name. See docs/designs/pr-previews.md §3.6.
    uniqueIndex("resource_project_name_base_unique")
      .on(table.projectId, table.name)
      .where(sql`environment_id is null`),
    uniqueIndex("resource_project_name_env_unique")
      .on(table.projectId, table.environmentId, table.name)
      .where(sql`environment_id is not null`),
    index("resource_project_id_idx").on(table.projectId),
    index("resource_environment_id_idx").on(table.environmentId),
  ],
);

export const databaseEngineEnum = pgEnum("database_engine", [
  "postgres",
  "redis",
  "mariadb",
  "mongodb",
  "clickhouse",
  "rabbitmq",
  "minio",
  "meilisearch",
]);

// Strategy a COW database branch was materialized with (shared value set with
// the SnapshotDriver zod schema in runtime/snapshot). `zfs` clones the volume;
// `copy` is the logical dump+restore fallback. See docs/designs/pr-previews.md §3.3.
export const branchStrategyEnum = pgEnum("branch_strategy", ["zfs", "copy"]);

export const databaseResource = pgTable(
  "database_resource",
  {
    resourceId: text("resource_id")
      .primaryKey()
      .$type<ResourceId>()
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
    // Keys in `extraEnv` that the operator marked sensitive. Display-only
    // hint — the value still travels the same wire path. Reveal in the UI
    // is gated by this list; copy/paste audit can also key off it.
    secretKeys: jsonb("secret_keys").$type<string[]>().notNull().default([]),
    // Enabled Postgres extensions (canonical `CREATE EXTENSION` names, e.g.
    // "pgcrypto", "vector", "postgis"). Non-contrib entries also drive the
    // service image: see packages/shared/postgres-extensions. Empty for
    // non-postgres engines. Changing this rolls the service (image may
    // change) and runs CREATE/DROP EXTENSION against the live database.
    extensions: jsonb("extensions").$type<string[]>().notNull().default([]),
    // COW branch bookkeeping. NULL branchStrategy = a base (unbranched) database.
    // When set, this row is a preview-env branch of another database; see
    // resource.branchedFromResourceId for provenance. See docs/designs/pr-previews.md §3.3.
    branchStrategy: branchStrategyEnum("branch_strategy"),
    // ZFS snapshot name the branch was cloned from — needed to destroy the
    // snapshot on teardown. NULL for the `copy` strategy (no snapshot exists).
    branchSnapshotRef: text("branch_snapshot_ref"),
    // Pre-migration Docker `local` volume name, for rows whose bytes still live
    // in /var/lib/docker/volumes/<name>. NULL once on the managed volumeDir path.
    legacyVolumeName: text("legacy_volume_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // databaseName / username are NOT globally unique: a COW branch reuses its
    // source's db name + user (Postgres ignores POSTGRES_* on a non-empty
    // PGDATA), and they only need to be unique *within a container* — which is
    // guaranteed by construction. Plain indexes for lookup. See §3.6.
    index("database_resource_database_name_idx").on(table.databaseName),
    index("database_resource_username_idx").on(table.username),
    // Hostnames stay globally unique — branches get distinct ones.
    uniqueIndex("database_resource_public_hostname_unique").on(table.publicHostname),
    uniqueIndex("database_resource_internal_hostname_unique").on(table.internalHostname),
  ],
);

/**
 * Credentials minted for a database that's STAGED in the manifest but not yet
 * provisioned. A database's identity (db name, username, hostname) is
 * deterministic from its name; only the password is random — so we generate it
 * the moment the operator adds the database, store it here, and show the real
 * connection details in the pending panel. At Deploy the provisioner reuses
 * this exact password, so what the operator copied pre-deploy keeps working.
 *
 * The row is transient: deleted once the real `database_resource` row exists
 * (post-provision) or when the staged change is discarded. Keyed by
 * (projectId, name) — the same identity the manifest uses for the entry.
 */
export const databaseDraftCredential = pgTable(
  "database_draft_credential",
  {
    projectId: text("project_id")
      .notNull()
      .$type<ProjectId>()
      .references(() => project.id, { onDelete: "cascade" }),
    // Manifest resource name (the `databases[name]` key).
    name: text("name").notNull(),
    // Random password generated at stage time, reused verbatim at deploy.
    password: text("password").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.name] })],
);

export const serviceRestartConditionEnum = pgEnum("service_restart_condition", [
  "none",
  "on-failure",
  "any",
]);

/**
 * Where a service's image comes from.
 *
 *   image  — pre-built image pulled from a registry. `serviceResource.image`
 *            is the source of truth; the swarm provisioner uses it directly.
 *            This is what every service created before the build pipeline
 *            landed is set to.
 *
 *   git    — built by apps/builder from the project's git binding. The
 *            wizard creates the row with `image` set to a `pending:…`
 *            placeholder; the first build pushes a real tag and bumps the
 *            column to it. Swarm provisioning is deferred until then so a
 *            placeholder pull never reaches the daemon.
 */
export const serviceSourceEnum = pgEnum("service_source", ["image", "git"]);

export const serviceResource = pgTable(
  "service_resource",
  {
    resourceId: text("resource_id")
      .primaryKey()
      .$type<ResourceId>()
      .references(() => resource.id, { onDelete: "cascade" }),

    image: text("image").notNull(),
    imageDigest: text("image_digest"),
    command: text("command").array(),
    entrypoint: text("entrypoint").array(),

    // How this service is sourced — see serviceSourceEnum above. Pre-build-
    // pipeline services default to "image" so the swarm provisioner keeps
    // working unchanged.
    source: serviceSourceEnum("source").notNull().default("image"),
    // Monorepo support: when source = "git", the path within the repo to
    // hand to nixpacks. Null = repo root.
    sourceSubdir: text("source_subdir"),
    // Framework/language detected at build time (next/vite/go/python/…), used
    // by the graph to render the service's brand logo. Captured by the builder
    // from the cloned repo + railpack's analysis — NOT from the git API — and
    // stored here so the graph reads it without any network call. Null until
    // the first successful build, or when nothing recognisable was detected.
    framework: text("framework").$type<FrameworkKind>(),

    replicas: integer("replicas").notNull().default(1),

    restartCondition: serviceRestartConditionEnum("restart_condition")
      .notNull()
      .default("on-failure"),
    restartMaxAttempts: integer("restart_max_attempts"),
    restartDelayMs: integer("restart_delay_ms").notNull().default(5000),
    // Window (ms) over which restartMaxAttempts is counted when
    // restartCondition = "on-failure". Outside the window the failure
    // counter resets. Maps to docker swarm `restart_policy.window`.
    restartWindowMs: integer("restart_window_ms"),

    healthcheckCmd: text("healthcheck_cmd").array(),
    healthcheckIntervalMs: integer("healthcheck_interval_ms"),
    healthcheckTimeoutMs: integer("healthcheck_timeout_ms"),
    healthcheckRetries: integer("healthcheck_retries"),
    healthcheckStartMs: integer("healthcheck_start_ms"),

    cpuLimit: numeric("cpu_limit", { precision: 4, scale: 2 }),
    memoryLimitMb: integer("memory_limit_mb"),
    cpuReservation: numeric("cpu_reservation", { precision: 4, scale: 2 }),
    memoryReservationMb: integer("memory_reservation_mb"),
    // Extended resource limits — match the manifest schema additions.
    // diskLimitMb is enforced via container --storage-opt size on docker
    // engines that support it; swapLimitMb maps to memory-swap; pidsLimit
    // maps to --pids-limit / deploy.resources.limits.pids.
    diskLimitMb: integer("disk_limit_mb"),
    swapLimitMb: integer("swap_limit_mb"),
    pidsLimit: integer("pids_limit"),

    // Lifecycle hooks — each runs once in a throwaway container off the
    // freshly-built image, on the project network, with the resolved env.
    // Exec-form (text[], one shell command per entry, run in order).
    //   preDeploy  — after the build, BEFORE the new replicas take traffic.
    //                A non-zero exit aborts the rollout. Use: db migrations.
    //   postDeploy — after the new replicas are live + healthy. Use: cache
    //                warmup, smoke checks, deploy pings.
    preDeploy: text("pre_deploy").array(),
    postDeploy: text("post_deploy").array(),

    // Build configuration for git-sourced services. Stored as jsonb so
    // the builder set can grow without DDL churn. Null for image-sourced
    // services. The discriminated `BuildConfig` shape is defined in
    // `@otterdeploy/shared/build-config` so the api/zod schema, the DB
    // type, and the service handler inputs all share one definition.
    buildConfig: jsonb("build_config").$type<BuildConfig>(),

    // Per-service git source binding. A git-sourced service owns its own repo +
    // branch (NOT the project's) so two services in one project can build from
    // two different repos. A push to `branch` of `gitRepoId` deploys just the
    // services bound to that (repo, branch) pair. Null for image-sourced
    // services, or a git service not yet bound (lands pending:initial, build
    // fails clearly until bound). branch is nullable — resolve the effective
    // branch at read time via `branch ?? repo.defaultBranch ?? "main"`. FK to
    // git_repo enforced app-side (cross-schema import cycle; see git.ts).
    gitRepoId: text("git_repo_id").$type<GitRepoId>(),
    branch: text("branch"),
    // Per-service image target: fully-qualified image name (no tag) the builder
    // pushes to; the builder appends <sha> + :latest. Null = registry-less local
    // build (image stays in the host daemon — the default). The push credential
    // is matched from the shared container_registry library by this string's
    // host at build time, so the manifest carries no opaque registry id.
    imageRepository: text("image_repository"),

    internalHostname: text("internal_hostname").notNull(),
    serviceName: text("service_name").notNull(),
    networkName: text("network_name").notNull(),

    publicEnabled: boolean("public_enabled").notNull().default(false),
    publicDomain: text("public_domain"),

    // When set, this service is a member of a Docker Compose stack — it was
    // materialized from the stack's compose file and is owned by it. Null for a
    // standalone service. Drives graph grouping (services sharing a stackId
    // render inside the stack's group) and stack teardown. We clear it + delete
    // the rows explicitly on stack delete, so SET NULL keeps the FK safe without
    // surprise-cascading the parent resource rows.
    stackId: text("stack_id")
      .$type<ResourceId>()
      .references(() => composeResource.resourceId, { onDelete: "set null" }),

    forceUpdateCounter: integer("force_update_counter").notNull().default(0),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("service_resource_service_name_unique").on(table.serviceName),
    index("service_resource_stack_id_idx").on(table.stackId),
    // Push routing: a webhook for (repo, branch) fans out to the services bound
    // to that pair. Replaces the old project-by-(gitRepoId, productionBranch)
    // lookup. See git/handle-push.ts.
    index("service_resource_git_repo_branch_idx").on(table.gitRepoId, table.branch),
    // internalHostname is the service's DNS alias on its project overlay
    // network — it only has to be unique *within that network*, not globally.
    // Two different projects (each on its own `otterdeploy-<project>` network)
    // can both run a service called "dealort". Scope the uniqueness to
    // (networkName, internalHostname) so same-named services across projects
    // don't collide.
    uniqueIndex("service_resource_network_hostname_unique").on(
      table.networkName,
      table.internalHostname,
    ),
    uniqueIndex("service_resource_public_domain_unique").on(table.publicDomain),
  ],
);

// ── Compose stack ───────────────────────────────────────────────────────
// A `type: compose` resource. One compose file → one swarm "stack" (N services
// on the project overlay network, all labelled `otterdeploy.stack=<resourceId>`
// so they list/remove as a unit). The file is the source of truth; `services`
// is a derived parse summary for the UI, refreshed on save/deploy. See
// docs/designs/compose.md.
export const composeSourceEnum = pgEnum("compose_source", ["inline", "git"]);

export const composeResource = pgTable(
  "compose_resource",
  {
    resourceId: text("resource_id")
      .primaryKey()
      .$type<ResourceId>()
      .references(() => resource.id, { onDelete: "cascade" }),
    source: composeSourceEnum("source").notNull().default("inline"),
    // inline source: the raw compose YAML pasted by the user.
    composeContent: text("compose_content"),
    // git source: repo + path to the compose file (default ./compose.yml).
    gitRepoUrl: text("git_repo_url"),
    gitRef: text("git_ref"),
    sourceSubdir: text("source_subdir"),
    composePath: text("compose_path"),
    // Swarm stack namespace — unique, derived `<projectSlug>-<resourceSlug>`.
    stackName: text("stack_name").notNull(),
    // Derived parse summary (service name, image, hasBuild, ports) for the UI.
    // NOT authoritative — recomputed from the file on every save/deploy.
    services: jsonb("services").$type<ComposeServiceSummary[]>().notNull().default([]),
    // Built image tags for `build:` services (service name → image ref), written
    // by the build worker. Image-only services aren't listed. See compose.md.
    builtImages: jsonb("built_images").$type<Record<string, string>>().notNull().default({}),
    // Which `service:port` are fronted by a public domain.
    exposed: jsonb("exposed").$type<ComposeExposed[]>().notNull().default([]),
    forceUpdateCounter: integer("force_update_counter").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("compose_resource_stack_name_unique").on(table.stackName)],
);

// Deployment — one logical "push" of a resource to swarm. Each create /
// redeploy / env-change inserts a new deployment row and tags the swarm
// spec with `otterdeploy.deployment.id=<id>` so the tasks docker schedules
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
  "git-push",
  "rollback",
]);

export const deployment = pgTable(
  "deployment",
  {
    id: text("id")
      .primaryKey()
      .$type<DeploymentId>()
      .$defaultFn(() => createId(ID_PREFIX.deployment)),
    resourceId: text("resource_id")
      .notNull()
      .$type<ResourceId>()
      .references(() => resource.id, { onDelete: "cascade" }),
    // Which environment this deployment belongs to. NULL on rows that pre-date
    // the env model (backfilled to the project's persistent env); preview
    // deploys carry the preview env id. See docs/designs/pr-previews.md.
    environmentId: text("environment_id").$type<EnvId>(),
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
    // Git provenance — populated when the deployment was triggered by a
    // push (reason="git-push") or built from a repo. Nullable for
    // image-only / database deployments.
    gitSha: text("git_sha"),
    gitRef: text("git_ref"),
    gitCommitMessage: text("git_commit_message"),
    gitCommitAuthor: text("git_commit_author"),
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
    index("deployment_resource_created_idx").on(table.resourceId, table.createdAt),
    index("deployment_environment_id_idx").on(table.environmentId),
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
export const serviceMountTypeEnum = pgEnum("service_mount_type", ["volume", "bind", "file"]);

export const serviceMount = pgTable(
  "service_mount",
  {
    id: text("id")
      .primaryKey()
      .$type<ServiceMountId>()
      .$defaultFn(() => createId(ID_PREFIX.serviceMount)),
    serviceResourceId: text("service_resource_id")
      .notNull()
      .$type<ResourceId>()
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
    uniqueIndex("service_mount_target_unique").on(table.serviceResourceId, table.target),
    index("service_mount_service_resource_id_idx").on(table.serviceResourceId),
  ],
);

export const servicePort = pgTable(
  "service_port",
  {
    id: text("id")
      .primaryKey()
      .$type<ServicePortId>()
      .$defaultFn(() => createId(ID_PREFIX.servicePort)),
    serviceResourceId: text("service_resource_id")
      .notNull()
      .$type<ResourceId>()
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
      .$type<ServiceEnvVarId>()
      .$defaultFn(() => createId(ID_PREFIX.serviceEnvVar)),
    serviceResourceId: text("service_resource_id")
      .notNull()
      .$type<ResourceId>()
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
      .$type<ProjectEnvVarId>()
      .$defaultFn(() => createId(ID_PREFIX.projectEnvVar)),
    projectId: text("project_id")
      .notNull()
      .$type<ProjectId>()
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
    uniqueIndex("project_env_var_unique").on(table.projectId, table.environmentId, table.key),
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
      .$type<ProjectEnvSubscriptionId>()
      .$defaultFn(() => createId(ID_PREFIX.projectEnvSubscription)),
    serviceResourceId: text("service_resource_id")
      .notNull()
      .$type<ResourceId>()
      .references(() => serviceResource.resourceId, { onDelete: "cascade" }),
    projectEnvKey: text("project_env_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_env_subscription_unique").on(table.serviceResourceId, table.projectEnvKey),
    index("project_env_subscription_service_resource_id_idx").on(table.serviceResourceId),
    index("project_env_subscription_key_idx").on(table.projectEnvKey),
  ],
);
