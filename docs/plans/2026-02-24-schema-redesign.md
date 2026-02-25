# Schema Redesign Plan

## Why

The current schema has significant structural problems:

1. **God table**: `projectResource` has 30+ columns cramming every resource type into one row, most nullable
2. **Denormalized orgId**: `organizationId` repeated on ~15 tables where it's derivable via FK chain
3. **No FK integrity**: `deployment.organizationId`, `auditLog.userId`, `resource.serverId` are plain text — no constraints
4. **Derived state stored**: `project_resource_link` persists dependency info that's implicit in resource config
5. **Overlapping enums**: `buildMethod` and `builder` share values (nixpacks, dockerfile, buildpack)
6. **Dual secret columns**: `gitProvider` has both `encryptedClientSecret` and `clientSecretReferenceId` — half-migrated
7. **jsonb escape hatches**: `metadata` bags on 6+ tables hiding what should be typed columns
8. **Redundant indexes**: `projectViewport` indexes its own PK
9. **Mixed concerns**: Build config, runtime config, deploy behavior, and UI state all in `projectResource`

## Decisions

- Auth tables (user, session, account, organization, member, invitation, apikey, twoFactor) stay **untouched** — managed by Better Auth
- Resource model: **single identity table + 1:1 type-specific config tables**
- UI canvas state (posX, posY, viewport): **kept in DB** for Zero sync across devices
- `project_resource_link`: **dropped** — dependency graph is derived from resource config at deploy time
- `deployment_event`: **kept** — useful for deploy timeline UI
- `deployment_secret_snapshot`: **kept** — needed for audit trail
- Metrics tables: **kept in Postgres** — acceptable at self-hosted PaaS scale

---

## Schema Overview

### Bounded Contexts

```
Auth (Better Auth — untouched)
├── user
├── session
├── account
├── organization
├── member
├── invitation
├── apikey
├── twoFactor
├── verification
└── deviceCode

Project
├── project
├── environment
├── resource            ← thin identity table (~10 shared columns)
├── resource_position   ← UI canvas state (posX, posY per resource)
└── viewport            ← UI canvas viewport per environment

Resource Config (1:1 extensions on resource)
├── service_config      ← web/api/worker: build, runtime, health check, scaling
├── database_config     ← database/cache: engine, image, credentials
├── volume_config       ← volume: mount path, size, driver
└── compose_config      ← compose: compose file content

Infrastructure
├── server
├── ssh_key
├── git_provider
├── git_repository
├── container_registry
├── custom_domain
└── caddy_instance

Operations
├── deployment
├── deployment_event
├── deployment_secret_snapshot
├── env_variable
├── backup
├── backup_schedule
├── config_file
├── scheduled_task_execution
├── notification_channel
└── audit_log

Metrics
├── resource_metric
└── resource_metric_hourly

Secrets
├── secret_provider_binding
└── secret_reference

Misc
└── webhook_delivery
```

---

## Table Designs

### project

Unchanged except: remove `baseDomain` (this belongs on `server`, which already has it).

```
project
├── id              text PK
├── organization_id text FK → organization.id CASCADE
├── owner_user_id   text FK → user.id CASCADE  NOT NULL
├── name            text NOT NULL
├── slug            text NOT NULL
├── deleted_at      timestamp
├── created_at      timestamp NOT NULL DEFAULT now()
└── updated_at      timestamp NOT NULL DEFAULT now()

UNIQUE(organization_id, slug)
INDEX(owner_user_id)
INDEX(organization_id)
```

### environment

Renamed from `project_environment`. Simpler name, same purpose.

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

### resource

The thin identity table. Only columns shared across ALL resource types.

```
resource
├── id              text PK
├── environment_id  text FK → environment.id CASCADE  NOT NULL
├── server_id       text FK → server.id SET NULL      ← proper FK now
├── kind            resource_kind NOT NULL             ← "web" | "api" | "worker" | "database" | "cache" | "volume" | "compose"
├── name            text NOT NULL
├── status          resource_status NOT NULL DEFAULT "unknown"
├── created_at      timestamp NOT NULL DEFAULT now()
└── updated_at      timestamp NOT NULL DEFAULT now()

INDEX(environment_id)
INDEX(kind)
INDEX(server_id)
```

**Removed from resource**: buildMethod, builder, dockerfilePath, buildCommand, watchPatterns, port, healthCheckPath, healthCheckInterval, healthCheckTimeout, replicas, cpuLimit, memoryLimit, startCommand, preDeployCommand, restartPolicy, restartPolicyMaxRetries, cronSchedule, cronCommand, registryId, composeFile, region, sleepApplication, overlapSeconds, drainingSeconds, posX, posY, metadata.

### resource_position (UI state for Zero sync)

```
resource_position
├── resource_id  text PK FK → resource.id CASCADE
├── pos_x        double NOT NULL DEFAULT 0
├── pos_y        double NOT NULL DEFAULT 0
└── updated_at   timestamp NOT NULL DEFAULT now()
```

### viewport (UI state for Zero sync)

```
viewport
├── environment_id  text PK FK → environment.id CASCADE
├── x               double NOT NULL DEFAULT 0
├── y               double NOT NULL DEFAULT 0
├── zoom            double NOT NULL DEFAULT 1
└── updated_at      timestamp NOT NULL DEFAULT now()
```

### service_config

For kind = "web" | "api" | "worker". Everything about building, running, and scaling a service.

```
service_config
├── id                          text PK
├── resource_id                 text FK → resource.id CASCADE  NOT NULL  UNIQUE
├── registry_id                 text FK → container_registry.id SET NULL  ← proper FK now
│
│  ── Build ──
├── builder                     builder_enum  ← "nixpacks" | "dockerfile" | "buildpack" | "railpack"
├── dockerfile_path             text DEFAULT "Dockerfile"
├── build_command               text
├── watch_patterns              text[]
│
│  ── Runtime ──
├── port                        integer
├── start_command               text
├── pre_deploy_command          text
├── restart_policy              restart_policy_enum
├── restart_policy_max_retries  integer
├── cron_schedule               text          ← for worker kind
├── cron_command                text          ← for worker kind
│
│  ── Health Check ──
├── health_check_path           text
├── health_check_interval       integer DEFAULT 30
├── health_check_timeout        integer
│
│  ── Scaling ──
├── replicas                    integer DEFAULT 1
├── cpu_limit                   real
├── memory_limit                integer
├── region                      text
├── sleep_application           boolean DEFAULT false
├── overlap_seconds             integer
├── draining_seconds            integer
│
├── created_at                  timestamp NOT NULL DEFAULT now()
└── updated_at                  timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
INDEX(registry_id)
```

**Enum consolidation**: `build_method` enum is dropped. `builder` enum is the single source of truth for how a service gets built. The old `build_method` values "docker_image", "static", "compose" are not builder choices — they're represented by the resource `kind` itself (compose kind, or a service with a direct image ref).

### database_config

For kind = "database" | "cache". Cleaned up from current version.

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

**Removed**: `typeConfig` jsonb bag. If you need type-specific knobs, add typed columns.

### volume_config

For kind = "volume". New table — previously this config was implicit.

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

### compose_config

For kind = "compose". New table — `composeFile` was on the god table.

```
compose_config
├── id              text PK
├── resource_id     text FK → resource.id CASCADE  NOT NULL  UNIQUE
├── compose_file    text NOT NULL
├── created_at      timestamp NOT NULL DEFAULT now()
└── updated_at      timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

---

### server

Remove `baseDomain` and `acmeEmail` duplication (these live on `caddy_instance`). Actually keep `baseDomain` on server since it's the server's wildcard domain. Remove `acmeEmail` since caddy_instance owns that.

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

**Removed**: `metadata` jsonb bag, `acmeEmail` (lives on caddy_instance).

### ssh_key

Add `updatedAt` for consistency.

```
ssh_key
├── id                              text PK
├── organization_id                 text FK → organization.id CASCADE  NOT NULL
├── name                            text NOT NULL
├── public_key                      text NOT NULL
├── private_key_secret_ref_id       text FK → secret_reference.id SET NULL
├── fingerprint                     text NOT NULL
├── created_at                      timestamp NOT NULL DEFAULT now()
└── updated_at                      timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(private_key_secret_ref_id)
```

**Removed**: `encryptedPrivateKey` — use secret_reference exclusively. No dual columns.

### git_provider

Clean up the dual secret column mess.

```
git_provider
├── id                          text PK
├── organization_id             text FK → organization.id CASCADE  NOT NULL
├── type                        text NOT NULL
├── name                        text NOT NULL
├── app_id                      text
├── client_id                   text
├── client_secret_ref_id        text FK → secret_reference.id SET NULL
├── installation_id             text
├── webhook_secret_ref_id       text FK → secret_reference.id SET NULL
├── created_at                  timestamp NOT NULL DEFAULT now()
└── updated_at                  timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
INDEX(client_secret_ref_id)
INDEX(webhook_secret_ref_id)
```

**Removed**: `encryptedClientSecret`, `encryptedWebhookSecret` — use secret_reference exclusively.

### git_repository

No changes needed. Already clean.

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

### container_registry

```
container_registry
├── id                  text PK
├── organization_id     text FK → organization.id CASCADE  NOT NULL
├── name                text NOT NULL
├── url                 text NOT NULL
├── username            text
├── password_secret_ref text FK → secret_reference.id SET NULL  ← proper FK
├── is_default          boolean NOT NULL DEFAULT false
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

INDEX(organization_id)
```

### custom_domain

Remove `organizationId` — derivable from resource → environment → project → org.

```
custom_domain
├── id                  text PK
├── resource_id         text FK → resource.id CASCADE  NOT NULL
├── domain              text NOT NULL UNIQUE
├── verified            boolean NOT NULL DEFAULT false
├── verification_token  text
├── ssl_status          ssl_status_enum NOT NULL DEFAULT "pending"
├── ssl_expires_at      timestamp
├── redirect_rules      jsonb DEFAULT []   ← keep: structured array, not a bag
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

### caddy_instance

```
caddy_instance
├── id                    text PK
├── server_id             text FK → server.id CASCADE  NOT NULL
├── status                caddy_status_enum NOT NULL DEFAULT "not_installed"
├── version               text
├── acme_email            text
├── last_health_check_at  timestamp
├── error_message         text
├── created_at            timestamp NOT NULL DEFAULT now()
└── updated_at            timestamp NOT NULL DEFAULT now()

INDEX(server_id)
```

**Removed**: `organizationId` (derivable from server → org), `metadata` jsonb bag.

---

### deployment

Remove `organizationId` — derivable from project → org. Add proper FK for `triggered_by`.

```
deployment
├── id                  text PK
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
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

INDEX(project_id)
INDEX(resource_id)
INDEX(status)
INDEX(created_at)
```

**Removed**: `organizationId` (derivable), `metadata` jsonb bag, `buildMethod` (replaced by `builder`).

### deployment_event

No changes. Already clean.

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

Note: `metadata` is acceptable here — events are polymorphic by nature and the bag captures event-specific context.

### deployment_secret_snapshot

Remove `organizationId` — derivable from deployment → project → org.

```
deployment_secret_snapshot
├── id              text PK
├── deployment_id   text FK → deployment.id CASCADE  NOT NULL  UNIQUE
├── resource_id     text FK → resource.id CASCADE  NOT NULL
├── entries_json    jsonb NOT NULL DEFAULT []
├── snapshot_hash   text NOT NULL
├── created_at      timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

### env_variable

Fix the polymorphic scope pattern. Instead of `scope` + `scopeId`, use explicit nullable FKs.

```
env_variable
├── id                  text PK
├── project_id          text FK → project.id CASCADE      ← nullable, set if scope=project
├── environment_id      text FK → environment.id CASCADE  ← nullable, set if scope=environment
├── resource_id         text FK → resource.id CASCADE     ← nullable, set if scope=resource
├── key                 text NOT NULL
├── secret_ref_id       text FK → secret_reference.id SET NULL
├── encrypted_value     text NOT NULL
├── is_build_time       boolean NOT NULL DEFAULT false
├── is_secret           boolean NOT NULL DEFAULT false
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

CHECK: exactly one of (project_id, environment_id, resource_id) is NOT NULL
UNIQUE(project_id, key) WHERE project_id IS NOT NULL
UNIQUE(environment_id, key) WHERE environment_id IS NOT NULL
UNIQUE(resource_id, key) WHERE resource_id IS NOT NULL
INDEX(project_id)
INDEX(environment_id)
INDEX(resource_id)
INDEX(secret_ref_id)
```

**Removed**: `organizationId` (derivable), `scope` enum, `scopeId` text. Replaced with proper FK columns + CHECK constraint.

### backup

Remove `organizationId`.

```
backup
├── id              text PK
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

INDEX(resource_id)
INDEX(created_at)
```

### backup_schedule

Remove `organizationId`.

```
backup_schedule
├── id                  text PK
├── resource_id         text FK → resource.id CASCADE  NOT NULL
├── cron_expression     text NOT NULL
├── enabled             boolean NOT NULL DEFAULT true
├── retention_count     integer DEFAULT 10
├── retention_days      integer DEFAULT 30
├── retention_max_size_gb integer
├── s3_bucket           text
├── s3_region           text
├── s3_endpoint         text
├── s3_access_key_ref   text FK → secret_reference.id SET NULL
├── s3_secret_key_ref   text FK → secret_reference.id SET NULL
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

### config_file

Remove `organizationId`.

```
config_file
├── id          text PK
├── resource_id text FK → resource.id CASCADE  NOT NULL
├── filename    text NOT NULL
├── content     text NOT NULL
├── mount_path  text NOT NULL
├── created_at  timestamp NOT NULL DEFAULT now()
└── updated_at  timestamp NOT NULL DEFAULT now()

INDEX(resource_id)
```

### scheduled_task_execution

Remove `organizationId`.

```
scheduled_task_execution
├── id              text PK
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

INDEX(resource_id)
INDEX(created_at)
```

### notification_channel

Keeps `organizationId` — it's a top-level org setting, not derivable from a child.

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

### audit_log

Add proper FKs. Keeps `organizationId` — audit logs should survive entity deletion.

```
audit_log
├── id              text PK
├── organization_id text FK → organization.id SET NULL  ← SET NULL, not CASCADE
├── user_id         text FK → user.id SET NULL          ← SET NULL, not CASCADE
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

---

### Secrets (unchanged structure, just cleanup)

`secret_provider_binding` and `secret_reference` stay as-is. They're well-designed.

---

### Metrics (unchanged)

`resource_metric` and `resource_metric_hourly` stay as-is.

---

### webhook_delivery (unchanged)

Stays as-is. Simple idempotency table.

---

## Enum Consolidation

### Drop
- `buildMethodEnum` — replaced by `builder` enum + resource `kind`

### Rename
- `builderEnum` stays as `builder`: "nixpacks" | "dockerfile" | "buildpack" | "railpack"

### Keep as-is
- `deployment_status`, `deployment_source`, `restart_policy`, `ssl_status`
- `server_status`, `server_role`, `backup_status`, `database_type`
- `resource_kind`, `resource_status`, `caddy_status`
- `secret_provider`, `secret_kind`, `secret_logical_scope`, `secret_provider_binding_status`

### Drop
- `env_var_scope` — replaced by explicit FK columns on `env_variable`
- `resource_link_type` — table dropped

---

## Summary of Changes

| Change | Count |
|---|---|
| Tables dropped | 2 (project_resource_link, project_resource_link) |
| Tables added | 3 (service_config, volume_config, compose_config) |
| Tables renamed | 2 (project_environment → environment, project_resource → resource) |
| `organizationId` removed | ~10 tables |
| Missing FKs fixed | 6 |
| `metadata` jsonb removed | 4 tables |
| Dual secret columns removed | 2 tables (git_provider, ssh_key) |
| Enums dropped | 3 (buildMethod, envVarScope, resourceLinkType) |
| God table columns moved | ~25 columns → service_config |

## File Organization

```
packages/db/src/schema/
├── auth.ts              ← untouched (Better Auth)
├── enums.ts             ← consolidated enums
├── project.ts           ← project, environment, resource, resource_position, viewport
├── resource-config.ts   ← service_config, database_config, volume_config, compose_config
├── infrastructure.ts    ← server, ssh_key, git_provider, git_repository, container_registry, custom_domain, caddy_instance
├── deployment.ts        ← deployment, deployment_event
├── operations.ts        ← env_variable, backup, backup_schedule, config_file, scheduled_task_execution, notification_channel, audit_log
├── secrets.ts           ← secret_provider_binding, secret_reference, deployment_secret_snapshot
├── metrics.ts           ← resource_metric, resource_metric_hourly, webhook_delivery
└── index.ts             ← re-exports
```
