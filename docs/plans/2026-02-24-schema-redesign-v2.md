# Schema Redesign Plan v2 (Merged, Implementation-Ready)

**Date:** 2026-02-24  
**Status:** Draft (requires ADR approval)  
**Supersedes for implementation planning:**  
- `2026-02-24-schema-redesign.md`  
- `2026-02-24-clean-db-schema-overview-plan.md`

---

## 1) Executive Summary

This redesign fixes schema quality problems by:

1. Splitting `project_resource` into a thin identity table plus typed config extensions.
2. Enforcing tenant-safe modeling with explicit `organization_id` on tenant-owned domain tables.
3. Replacing implicit/polymorphic patterns with explicit FKs and constraints.
4. Removing dual secret storage patterns.
5. Introducing a staged migration strategy (additive -> backfill -> dual-write -> cutover -> cleanup).

---

## 2) Current Problems (Validated)

1. `project_resource` is a god table with unrelated nullable columns (build/runtime/job/infra/UI concerns mixed).
2. Inconsistent referential integrity in operational tables.
3. Secret representation is inconsistent (encrypted inline + secret reference coexistence).
4. Context boundaries are blurry (for example mixed content in `metrics.ts`).
5. Scope modeling for env vars is polymorphic (`scope + scopeId`) and weakly constrained.
6. Excessive fallback to generic `jsonb metadata` where typed schema is better.

---

## 3) Final Decisions

1. **Auth tables remain unchanged** (Better Auth managed): `user`, `session`, `account`, `organization`, `member`, `invitation`, `apikey`, `two_factor`, `verification`, `device_code`.
2. **Resource model is normalized**: `resource` + extension tables (`resource_runtime_config`, `resource_build_config`, `resource_job_config`, `resource_compose_config`, `database_config`, `volume_config`).
3. **Tenant key strategy (resolved)**: keep `organization_id` on tenant-owned operational/domain tables for authorization and query performance. Do not remove it just because it is derivable.
4. **Project/server domains (resolved)**: keep both:
   - `project.base_domain` (project override)
   - `server.base_domain` (server default/fallback)
5. **Secrets strategy**: use `secret_reference` as canonical secret pointer; remove duplicate inline encrypted secret columns where both exist.
6. **UI state kept in DB** for Zero sync (`resource_position`, `viewport`).
7. **Migration policy**: no big-bang rewrite; staged rollout with parity checks.

---

## 4) Target Bounded Contexts

## 4.1 Auth (unchanged)
- Better Auth tables only.

## 4.2 Tenancy & Project Topology
- `project`
- `environment` (rename from `project_environment`)
- `resource` (rename from `project_resource`)
- `resource_position`
- `viewport`

## 4.3 Resource Config Extensions
- `resource_runtime_config`
- `resource_build_config`
- `resource_job_config`
- `resource_compose_config`
- `database_config`
- `volume_config`

## 4.4 Infrastructure
- `server`
- `ssh_key`
- `git_provider`
- `git_repository`
- `container_registry`
- `caddy_instance`
- `custom_domain`
- `webhook_delivery`

## 4.5 Operations
- `deployment`
- `deployment_event`
- `deployment_secret_snapshot`
- `environment_variable`
- `backup`
- `backup_schedule`
- `config_file`
- `scheduled_task_execution`
- `notification_channel`
- `audit_log`

## 4.6 Observability
- `resource_metric`
- `resource_metric_hourly`

---

## 5) Canonical Table Model (High Signal)

## 5.1 Tenancy & Topology

### `project`

```
project
├── id              text PK
├── organization_id text FK → organization.id CASCADE
├── owner_user_id   text FK → user.id CASCADE  NOT NULL
├── name            text NOT NULL
├── slug            text NOT NULL
├── base_domain     text                       ← project-level override of server default
├── deleted_at      timestamp
├── created_at      timestamp NOT NULL DEFAULT now()
└── updated_at      timestamp NOT NULL DEFAULT now()

UNIQUE(organization_id, slug)
INDEX(owner_user_id)
INDEX(organization_id)
```

### `environment` (renamed from `project_environment`)

```
environment
├── id          text PK
├── project_id  text FK → project.id CASCADE  NOT NULL
├── name        text NOT NULL
├── created_at  timestamp NOT NULL DEFAULT now()
└── updated_at  timestamp NOT NULL DEFAULT now()

UNIQUE(project_id, name)
INDEX(project_id)
```

### `resource` (renamed from `project_resource`)

Shared identity only. All type-specific columns removed to config extension tables.

```
resource
├── id              text PK
├── organization_id text FK → organization.id CASCADE  NOT NULL
├── project_id      text FK → project.id CASCADE  NOT NULL
├── environment_id  text FK → environment.id CASCADE  NOT NULL
├── server_id       text FK → server.id SET NULL
├── kind            resource_kind_enum NOT NULL
├── name            text NOT NULL
├── status          resource_status_enum NOT NULL DEFAULT "unknown"
├── deleted_at      timestamp
├── created_at      timestamp NOT NULL DEFAULT now()
└── updated_at      timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(environment_id)
INDEX(kind)
INDEX(server_id)
```

Columns removed (moved to config tables): `build_method`, `builder`, `dockerfile_path`, `build_command`, `watch_patterns`, `port`, `health_check_path`, `health_check_interval`, `health_check_timeout`, `replicas`, `cpu_limit`, `memory_limit`, `start_command`, `pre_deploy_command`, `restart_policy`, `restart_policy_max_retries`, `cron_schedule`, `cron_command`, `registry_id`, `compose_file`, `region`, `sleep_application`, `overlap_seconds`, `draining_seconds`, `pos_x`, `pos_y`, `metadata`.

### `resource_position` (UI state for Zero sync)

```
resource_position
├── resource_id  text PK FK → resource.id CASCADE
├── pos_x        double NOT NULL DEFAULT 0
├── pos_y        double NOT NULL DEFAULT 0
└── updated_at   timestamp NOT NULL DEFAULT now()
```

### `viewport` (UI state for Zero sync)

```
viewport
├── environment_id  text PK FK → environment.id CASCADE
├── x               double NOT NULL DEFAULT 0
├── y               double NOT NULL DEFAULT 0
├── zoom            double NOT NULL DEFAULT 1
└── updated_at      timestamp NOT NULL DEFAULT now()
```

## 5.2 Resource Config Split

### `resource_runtime_config` (1:1 with `resource`)

Applies to: kind = "web" | "api" | "worker". How the container runs.

```
resource_runtime_config
├── id                          text PK
├── resource_id                 text FK → resource.id CASCADE  NOT NULL  UNIQUE
├── port                        integer
├── start_command               text
├── restart_policy              restart_policy_enum
├── restart_policy_max_retries  integer
├── replicas                    integer DEFAULT 1
├── cpu_limit                   real
├── memory_limit                integer
├── region                      text
├── sleep_application           boolean DEFAULT false
├── health_check_path           text
├── health_check_interval       integer DEFAULT 30
├── health_check_timeout        integer
├── created_at                  timestamp NOT NULL DEFAULT now()
└── updated_at                  timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

### `resource_build_config` (1:1 with `resource`)

Applies to: kind = "web" | "api" | "worker". How the image gets built.

```
resource_build_config
├── id                  text PK
├── resource_id         text FK → resource.id CASCADE  NOT NULL  UNIQUE
├── registry_id         text FK → container_registry.id SET NULL
├── builder             builder_enum       ← "nixpacks" | "dockerfile" | "buildpack" | "railpack"
├── dockerfile_path     text DEFAULT "Dockerfile"
├── build_command       text
├── watch_patterns      text[]
├── root_directory      text DEFAULT "/"
├── pre_deploy_command  text
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
INDEX(registry_id)
```

### `resource_job_config` (1:1 with `resource`)

Applies to: kind = "worker" (cron-based). Scheduling and rollover behavior.

```
resource_job_config
├── id                text PK
├── resource_id       text FK → resource.id CASCADE  NOT NULL  UNIQUE
├── cron_schedule     text NOT NULL
├── cron_command      text NOT NULL
├── overlap_seconds   integer
├── draining_seconds  integer
├── created_at        timestamp NOT NULL DEFAULT now()
└── updated_at        timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

### `resource_compose_config` (1:1 with `resource`)

Applies to: kind = "compose". Docker Compose stack managed as a single resource.

```
resource_compose_config
├── id              text PK
├── resource_id     text FK → resource.id CASCADE  NOT NULL  UNIQUE
├── compose_file    text NOT NULL          ← raw compose YAML content
├── compose_path    text DEFAULT "docker-compose.yml"
├── created_at      timestamp NOT NULL DEFAULT now()
└── updated_at      timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

### `database_config` (keep, tighten)

Applies to: kind = "database" | "cache".

```
database_config
├── id              text PK
├── resource_id     text FK → resource.id CASCADE  NOT NULL  UNIQUE
├── database_type   database_type_enum NOT NULL
├── image           text NOT NULL
├── database_name   text
├── database_user   text
├── external_port   integer
├── custom_config   text
├── created_at      timestamp NOT NULL DEFAULT now()
└── updated_at      timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
INDEX(database_type)
```

Removed: `type_config` jsonb bag. Add typed columns if engine-specific knobs are needed.

### `volume_config` (new)

Applies to: kind = "volume".

```
volume_config
├── id            text PK
├── resource_id   text FK → resource.id CASCADE  NOT NULL  UNIQUE
├── mount_path    text NOT NULL
├── size_gb       integer
├── driver        text DEFAULT "local"
├── created_at    timestamp NOT NULL DEFAULT now()
└── updated_at    timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

## 5.3 Infrastructure Tables

### `server`

```
server
├── id                        text PK
├── organization_id           text FK → organization.id CASCADE  NOT NULL
├── name                      text NOT NULL
├── ip_address                text NOT NULL
├── port                      integer NOT NULL DEFAULT 22
├── ssh_key_id                text FK → ssh_key.id SET NULL
├── status                    server_status_enum NOT NULL DEFAULT "disconnected"
├── role                      server_role_enum NOT NULL DEFAULT "worker"
├── docker_version            text
├── os                        text
├── arch                      text
├── total_memory              bigint
├── total_cpu                 integer
├── total_disk                bigint
├── swarm_node_id             text
├── base_domain               text
├── docker_cleanup_threshold  integer DEFAULT 80
├── last_seen_at              timestamp
├── created_at                timestamp NOT NULL DEFAULT now()
└── updated_at                timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
```

Removed: `metadata` jsonb bag, `acme_email` (moved to `caddy_instance`).

### `ssh_key`

```
ssh_key
├── id                          text PK
├── organization_id             text FK → organization.id CASCADE  NOT NULL
├── name                        text NOT NULL
├── public_key                  text NOT NULL
├── private_key_secret_ref_id   text FK → secret_reference.id SET NULL
├── fingerprint                 text NOT NULL
├── created_at                  timestamp NOT NULL DEFAULT now()
└── updated_at                  timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(private_key_secret_ref_id)
```

Removed: `encrypted_private_key` — use `secret_reference` exclusively. No dual columns.
Added: `updated_at` (was missing).

### `git_provider`

```
git_provider
├── id                      text PK
├── organization_id         text FK → organization.id CASCADE  NOT NULL
├── type                    text NOT NULL
├── name                    text NOT NULL
├── app_id                  text
├── client_id               text
├── client_secret_ref_id    text FK → secret_reference.id SET NULL
├── installation_id         text
├── webhook_secret_ref_id   text FK → secret_reference.id SET NULL
├── created_at              timestamp NOT NULL DEFAULT now()
└── updated_at              timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(client_secret_ref_id)
INDEX(webhook_secret_ref_id)
```

Removed: `encrypted_client_secret`, `encrypted_webhook_secret` — use `secret_reference` exclusively.

### `git_repository`

No structural changes. Already clean.

```
git_repository
├── id              text PK
├── resource_id     text FK → resource.id CASCADE  NOT NULL
├── git_provider_id text FK → git_provider.id CASCADE  NOT NULL
├── owner           text NOT NULL
├── name            text NOT NULL
├── branch          text NOT NULL DEFAULT "main"
├── root_directory  text DEFAULT "/"
├── auto_deploy     boolean NOT NULL DEFAULT true
├── webhook_id      text
├── watch_paths     text[]
├── created_at      timestamp NOT NULL DEFAULT now()
└── updated_at      timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

### `container_registry`

```
container_registry
├── id                      text PK
├── organization_id         text FK → organization.id CASCADE  NOT NULL
├── name                    text NOT NULL
├── url                     text NOT NULL
├── username                text
├── password_secret_ref_id  text FK → secret_reference.id SET NULL  ← proper FK now
├── is_default              boolean NOT NULL DEFAULT false
├── created_at              timestamp NOT NULL DEFAULT now()
└── updated_at              timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
```

### `custom_domain`

```
custom_domain
├── id                  text PK
├── organization_id     text FK → organization.id CASCADE  NOT NULL
├── resource_id         text FK → resource.id CASCADE  NOT NULL
├── domain              text NOT NULL UNIQUE
├── verified            boolean NOT NULL DEFAULT false
├── verification_token  text
├── ssl_status          ssl_status_enum NOT NULL DEFAULT "pending"
├── ssl_expires_at      timestamp
├── redirect_rules      jsonb DEFAULT []    ← structured array, acceptable
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(resource_id)
```

### `caddy_instance`

```
caddy_instance
├── id                    text PK
├── server_id             text FK → server.id CASCADE  NOT NULL
├── status                caddy_status_enum NOT NULL DEFAULT "not_installed"
├── version               text
├── acme_email            text          ← moved here from server
├── last_health_check_at  timestamp
├── error_message         text
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()

INDEX(server_id)
```

Removed: `organization_id` (derivable from server → org), `metadata` jsonb bag.

### `webhook_delivery`

No changes. Simple idempotency table.

```
webhook_delivery
├── id          text PK
├── received_at timestamp NOT NULL DEFAULT now()
└── created_at  timestamp NOT NULL DEFAULT now()

INDEX(created_at)
```

## 5.4 Operations Tables

### `deployment`

```
deployment
├── id                  text PK
├── organization_id     text FK → organization.id CASCADE  NOT NULL
├── project_id          text FK → project.id CASCADE  NOT NULL
├── environment_id      text FK → environment.id CASCADE  NOT NULL
├── resource_id         text FK → resource.id CASCADE  NOT NULL
├── status              deployment_status_enum NOT NULL DEFAULT "queued"
├── source              deployment_source_enum NOT NULL DEFAULT "manual"
├── git_ref             text
├── git_commit_sha      text
├── git_commit_message  text
├── builder             builder_enum
├── image_tag           text
├── previous_image_tag  text
├── started_at          timestamp
├── completed_at        timestamp
├── duration            integer
├── triggered_by        text FK → user.id SET NULL  ← proper FK now
├── idempotency_key     text                        ← webhook deploy dedupe
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(project_id)
INDEX(resource_id)
INDEX(status)
INDEX(created_at)
UNIQUE(idempotency_key) WHERE idempotency_key IS NOT NULL
```

Removed: `metadata` jsonb bag, `build_method` (replaced by `builder`).
Added: `idempotency_key` for webhook-driven deploy dedupe.

### `deployment_event`

No structural changes. `metadata` is acceptable here — events are polymorphic by nature.

```
deployment_event
├── id              text PK
├── deployment_id   text FK → deployment.id CASCADE  NOT NULL
├── status          deployment_status_enum NOT NULL
├── previous_status deployment_status_enum
├── actor           text
├── reason          text
├── metadata        jsonb NOT NULL DEFAULT {}
├── created_at      timestamp NOT NULL DEFAULT now()

INDEX(deployment_id)
INDEX(created_at)
```

### `deployment_secret_snapshot`

```
deployment_secret_snapshot
├── id              text PK
├── organization_id text FK → organization.id CASCADE  NOT NULL
├── deployment_id   text FK → deployment.id CASCADE  NOT NULL  UNIQUE
├── resource_id     text FK → resource.id CASCADE  NOT NULL
├── entries_json    jsonb NOT NULL DEFAULT []    ← encrypted at rest
├── snapshot_hash   text NOT NULL
├── created_at      timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(resource_id)
```

### `environment_variable` (critical redesign)

Replace polymorphic `scope + scope_id` with explicit nullable FKs + CHECK constraint.

```
environment_variable
├── id                  text PK
├── organization_id     text FK → organization.id CASCADE  NOT NULL
├── project_id          text FK → project.id CASCADE       ← nullable
├── environment_id      text FK → environment.id CASCADE   ← nullable
├── resource_id         text FK → resource.id CASCADE      ← nullable
├── key                 text NOT NULL
├── secret_ref_id       text FK → secret_reference.id SET NULL
├── encrypted_value     text NOT NULL
├── is_build_time       boolean NOT NULL DEFAULT false
├── is_secret           boolean NOT NULL DEFAULT false
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

CHECK: exactly one of (project_id, environment_id, resource_id) IS NOT NULL
UNIQUE(project_id, key)      WHERE project_id IS NOT NULL
UNIQUE(environment_id, key)  WHERE environment_id IS NOT NULL
UNIQUE(resource_id, key)     WHERE resource_id IS NOT NULL
INDEX(organization_id)
INDEX(project_id)
INDEX(environment_id)
INDEX(resource_id)
INDEX(secret_ref_id)
```

Removed: `scope` enum, `scope_id` text column. Replaced with proper FK columns.

### `backup`

```
backup
├── id              text PK
├── organization_id text FK → organization.id CASCADE  NOT NULL
├── resource_id     text FK → resource.id CASCADE  NOT NULL
├── type            text NOT NULL
├── status          backup_status_enum NOT NULL DEFAULT "pending"
├── storage_key     text
├── size            bigint
├── checksum        text
├── started_at      timestamp
├── completed_at    timestamp
├── expires_at      timestamp
├── error_message   text
├── created_at      timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(resource_id)
INDEX(created_at)
```

Removed: `metadata` jsonb bag.

### `backup_schedule`

```
backup_schedule
├── id                    text PK
├── organization_id       text FK → organization.id CASCADE  NOT NULL
├── resource_id           text FK → resource.id CASCADE  NOT NULL
├── cron_expression       text NOT NULL
├── enabled               boolean NOT NULL DEFAULT true
├── retention_count       integer DEFAULT 10
├── retention_days        integer DEFAULT 30
├── retention_max_size_gb integer
├── s3_bucket             text
├── s3_region             text
├── s3_endpoint           text
├── s3_access_key_ref     text FK → secret_reference.id SET NULL
├── s3_secret_key_ref     text FK → secret_reference.id SET NULL
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(resource_id)
```

### `config_file`

```
config_file
├── id          text PK
├── organization_id text FK → organization.id CASCADE  NOT NULL
├── resource_id text FK → resource.id CASCADE  NOT NULL
├── filename    text NOT NULL
├── content     text NOT NULL
├── mount_path  text NOT NULL
├── created_at  timestamp NOT NULL DEFAULT now()
└── updated_at  timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(resource_id)
```

### `scheduled_task_execution`

```
scheduled_task_execution
├── id              text PK
├── organization_id text FK → organization.id CASCADE  NOT NULL
├── resource_id     text FK → resource.id CASCADE  NOT NULL
├── command         text NOT NULL
├── cron_expression text
├── status          text NOT NULL DEFAULT "pending"
├── exit_code       integer
├── stdout          text
├── stderr          text
├── duration        integer
├── started_at      timestamp
├── completed_at    timestamp
├── created_at      timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(resource_id)
INDEX(created_at)
```

### `notification_channel`

Org-level settings. No resource association.

```
notification_channel
├── id              text PK
├── organization_id text FK → organization.id CASCADE  NOT NULL
├── type            text NOT NULL
├── name            text NOT NULL
├── config          jsonb NOT NULL
├── enabled         boolean NOT NULL DEFAULT true
├── event_filter    jsonb
├── created_at      timestamp NOT NULL DEFAULT now()
└── updated_at      timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
```

### `audit_log`

FKs use SET NULL — audit logs must survive entity deletion.

```
audit_log
├── id              text PK
├── organization_id text FK → organization.id SET NULL
├── user_id         text FK → user.id SET NULL
├── action          text NOT NULL
├── entity_type     text NOT NULL
├── entity_id       text NOT NULL
├── metadata        jsonb NOT NULL DEFAULT {}
├── ip_address      text
├── user_agent      text
├── created_at      timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(entity_type, entity_id)
INDEX(created_at)
INDEX(user_id)
```

## 5.5 Observability Tables

### `resource_metric`

Append-only raw container stats. 30s collection, 7-day retention.

```
resource_metric
├── id            text PK
├── resource_id   text FK → resource.id CASCADE  NOT NULL
├── timestamp     timestamp NOT NULL
├── cpu_percent   double
├── memory_used   bigint
├── memory_limit  bigint
├── network_rx    bigint
├── network_tx    bigint
├── disk_read     bigint
├── disk_write    bigint

INDEX(resource_id, timestamp DESC)
INDEX(timestamp)
```

### `resource_metric_hourly`

Rollup aggregates. 90-day retention.

```
resource_metric_hourly
├── id                text PK
├── resource_id       text FK → resource.id CASCADE  NOT NULL
├── timestamp         timestamp NOT NULL
├── cpu_avg           double
├── cpu_max           double
├── cpu_p95           double
├── memory_avg        bigint
├── memory_max        bigint
├── memory_p95        bigint
├── network_rx_total  bigint
├── network_tx_total  bigint
├── disk_read_total   bigint
├── disk_write_total  bigint

INDEX(resource_id, timestamp DESC)
INDEX(timestamp)
```

---

## 5.6 Dropped Tables

### `project_resource_link` — DROPPED

Previously modeled dependency edges between resources (depends_on, network, mounts). This is derived state:
- Dependencies are implicit in resource config (e.g. a service referencing a database's connection string).
- Network topology is determined at deploy time by Docker Swarm service definitions.
- Visual arrows on the architecture canvas are rendered from config, not stored separately.

No replacement table needed.

### `project_viewport` index cleanup

`project_viewport` had an index on `environment_id` which is already the primary key. The redundant index is removed in the renamed `viewport` table.

---

## 6) Enum Strategy

### Drop (3 enums)

| Enum | Reason |
|---|---|
| `build_method` | Overlaps with `builder`. "docker_image", "static", "compose" are modeled by resource `kind` + config tables. |
| `env_var_scope` | Replaced by explicit FK columns on `environment_variable`. |
| `resource_link_type` | Table dropped. |

### Keep (14 enums)

| Enum | Used by |
|---|---|
| `builder` | `resource_build_config.builder`, `deployment.builder` |
| `deployment_status` | `deployment.status`, `deployment_event.status` |
| `deployment_source` | `deployment.source` |
| `restart_policy` | `resource_runtime_config.restart_policy` |
| `ssl_status` | `custom_domain.ssl_status` |
| `server_status` | `server.status` |
| `server_role` | `server.role` |
| `backup_status` | `backup.status` |
| `database_type` | `database_config.database_type` |
| `resource_kind` | `resource.kind` |
| `resource_status` | `resource.status` |
| `caddy_status` | `caddy_instance.status` |
| `secret_provider` | `secret_provider_binding.provider`, `secret_reference.provider` |
| `secret_kind` | `secret_reference.kind` |
| `secret_logical_scope` | `secret_reference.logical_scope` |
| `secret_provider_binding_status` | `secret_provider_binding.status` |

---

## 7) Constraint & Index Standards

1. Every tenant-owned table has `organization_id` + index.
2. Every foreign key is explicit (no plain text pseudo-reference fields in domain tables).
3. Unique constraints for business keys, not just IDs.
4. Remove indexes that duplicate PK coverage.
5. Prefer typed columns over `metadata` bags; permit `metadata` only for true polymorphic event payloads.

---

## 8) Migration Plan (Required, No Big Bang)

## Phase 0 - Contract Freeze
1. Freeze additional schema churn.
2. Approve this target model in ADR.

## Phase 1 - Additive Schema (v2)
1. Create renamed/new tables and extension tables.
2. Add new indexes and constraints.
3. Keep old tables/columns intact.

## Phase 2 - Backfill
1. Backfill v2 from existing schema.
2. Validate counts, FK consistency, and key-field parity checksums.

## Phase 3 - Dual Write
1. Write both old and new paths from domain services.
2. Add divergence checks and alerting.

## Phase 4 - Read Cutover
1. Switch reads to v2 behind feature flags.
2. Burn in under production traffic.

## Phase 5 - Decommission
1. Remove old writes, then old reads.
2. Drop deprecated tables/columns and deprecated enums in final cleanup migrations.

---

## 9) Old -> New Mapping (Key Moves)

### Table renames
1. `project_environment` → `environment`
2. `project_resource` → `resource` (identity-only)
3. `project_viewport` → `viewport`

### Table drops
4. `project_resource_link` → dropped (derived state, not stored)

### Table additions
5. `resource_runtime_config` (new — columns from `project_resource`)
6. `resource_build_config` (new — columns from `project_resource`)
7. `resource_job_config` (new — columns from `project_resource`)
8. `resource_compose_config` (new — `compose_file` from `project_resource`)
9. `volume_config` (new — previously implicit)
10. `resource_position` (new — `pos_x`/`pos_y` from `project_resource`)

### Column moves
11. `project_resource.{port, replicas, health_check_*, restart_policy*, cpu_limit, memory_limit, start_command, region, sleep_application}` → `resource_runtime_config`
12. `project_resource.{builder, dockerfile_path, build_command, watch_patterns, pre_deploy_command, registry_id}` → `resource_build_config`
13. `project_resource.{cron_schedule, cron_command, overlap_seconds, draining_seconds}` → `resource_job_config`
14. `project_resource.{compose_file}` → `resource_compose_config`
15. `project_resource.{pos_x, pos_y}` → `resource_position`
16. `server.acme_email` → `caddy_instance.acme_email`

### Pattern changes
17. `environment_variable.{scope, scope_id}` → explicit nullable FK columns (`project_id`, `environment_id`, `resource_id`) + CHECK constraint
18. `ssh_key.encrypted_private_key` → removed (use `secret_reference` only)
19. `git_provider.{encrypted_client_secret, encrypted_webhook_secret}` → removed (use `secret_reference` only)
20. `deployment.build_method` → `deployment.builder` (single enum)

### Enum drops
21. `build_method` enum → dropped (replaced by `builder` + resource `kind`)
22. `env_var_scope` enum → dropped (replaced by explicit FK columns)
23. `resource_link_type` enum → dropped (table dropped)

### Column drops (metadata bags)
24. `project_resource.metadata` → dropped
25. `server.metadata` → dropped
26. `caddy_instance.metadata` → dropped
27. `deployment.metadata` → dropped
28. `backup.metadata` → dropped
29. `database_config.type_config` → dropped

---

## 10) Acceptance Criteria

1. No god-table behavior in `resource`.
2. Tenant-owned tables enforce org scoping + FK integrity.
3. Env var scope model enforces exactly-one-parent at DB level.
4. Secret storage has one canonical pattern per credential type.
5. Backfill + dual-write produce zero drift before read cutover.
6. Query performance for hot paths is verified with production-like dataset.

---

## 11) Implementation Backlog (Execution Order)

1. ADR approval for v2 model and naming.
2. Additive migration set A: topology + resource split tables.
3. Additive migration set B: env var scope redesign + constraints.
4. Additive migration set C: secret column cleanup path.
5. Backfill scripts + parity validators.
6. Dual-write implementation in domain layer.
7. Read cutover flags and rollout plan.
8. Final cleanup migrations.

---

## 12) Target File Organization

```
packages/db/src/schema/
├── auth.ts              ← untouched (Better Auth)
├── enums.ts             ← consolidated (3 enums dropped)
├── project.ts           ← project, environment, resource, resource_position, viewport
├── resource-config.ts   ← resource_runtime_config, resource_build_config, resource_job_config,
│                          resource_compose_config, database_config, volume_config
├── infrastructure.ts    ← server, ssh_key, git_provider, git_repository, container_registry,
│                          custom_domain, caddy_instance
├── deployment.ts        ← deployment, deployment_event
├── operations.ts        ← environment_variable, backup, backup_schedule, config_file,
│                          scheduled_task_execution, notification_channel, audit_log
├── secrets.ts           ← secret_provider_binding, secret_reference, deployment_secret_snapshot
├── metrics.ts           ← resource_metric, resource_metric_hourly, webhook_delivery
└── index.ts             ← re-exports all
```

---

## 13) Notes on Existing Docs

1. `2026-02-24-schema-redesign.md` remains useful as raw detail source but includes unresolved contradictions and should not be used directly for migration execution.
2. `2026-02-24-clean-db-schema-overview-plan.md` remains useful as strategy baseline; this v2 doc is the merged execution reference.

