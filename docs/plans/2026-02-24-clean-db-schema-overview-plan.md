# OtterStack DB Schema Overhaul Plan (Overview First)

**Date:** 2026-02-24  
**Status:** Draft  
**Objective:** Replace the current mixed/overloaded schema shape with a clean, domain-driven, migration-safe schema.

---

## 1) Overview (Current State)

The current schema works, but quality is inconsistent and hard to scale safely. Main issues:

1. `project_resource` is overloaded with many nullable columns across unrelated concerns (build, runtime, cron, deploy, infra placement).
2. Context boundaries are blurry (`metrics.ts` currently contains observability, infra, config-file, registry, webhook dedupe, and backup scheduling).
3. Some constraints are missing or implicit (tenant boundaries, unique constraints, check constraints, enum ownership).
4. Secret handling and config storage are split in ways that increase ambiguity (`encrypted*` + secret references co-existing in several tables).
5. Naming and normalization are uneven (some scoped data is explicit, some hidden in metadata JSON).

This plan defines a clean target schema and a safe rollout strategy.

---

## 2) Target Design Principles

1. **Clear bounded contexts**: auth, tenancy/project model, resource catalog, deployment, infra control plane, secrets, domains/routing, backups, observability, audit/notifications.
2. **Single responsibility per table**: base entity + optional typed extension tables.
3. **Strict tenant safety**: every tenant-owned row carries `organization_id` with FK + indexed lookup path.
4. **Predictable constraints**: explicit unique keys, check constraints, and FK actions.
5. **Minimal magic JSON**: use typed columns first; use `jsonb` only for true unstructured extensions.
6. **Migration-safe evolution**: additive rollout, dual-write period, cutover, then cleanup.

---

## 3) Clean Schema Shape (Proposed)

## 3.1 Core Tenancy & Projecting

Keep:
- `organization`, `member`, `project`, `project_environment`

Rules:
- Unique project slug per org.
- Unique environment name per project.
- All project-scoped tables must include `organization_id` for fast tenant filtering and RLS readiness.

## 3.2 Resource Model Split (critical fix)

Replace overloaded `project_resource` shape with:

1. `resource`
- identity and placement only: `id`, `organization_id`, `project_id`, `environment_id`, `kind`, `name`, `status`, `server_id`, `created_at`, `updated_at`, `deleted_at`

2. `resource_runtime_config`
- runtime: `port`, `replicas`, `health_check_path`, `health_check_interval`, `health_check_timeout`, `restart_policy`, `restart_policy_max_retries`, `cpu_limit`, `memory_limit`, `start_command`

3. `resource_build_config`
- build: `build_method`, `builder`, `dockerfile_path`, `build_command`, `watch_patterns`, `root_directory`, `pre_deploy_command`, `registry_id`

4. `resource_job_config`
- jobs/cron only: `cron_schedule`, `cron_command`, `overlap_seconds`, `draining_seconds`

5. `resource_compose_config`
- compose only: `compose_file`, `sleep_application`, `region`

6. `database_config`
- keep as typed extension table for `kind in ('database','cache')`

Result:
- Fewer null-heavy rows.
- Easier invariants and validation by resource kind.

## 3.3 Deployment Model

Keep:
- `deployment`, `deployment_event`

Improve:
- Add DB constraint for legal status transitions (or validate in domain layer + enforce by trigger if needed).
- Add dedupe key for webhook-based deploy requests (`resource_id + git_commit_sha + source`) when desired.
- Keep immutable deployment facts separate from mutable execution metadata.

## 3.4 Infrastructure Control Plane

Keep and normalize:
- `server`, `ssh_key`, `git_provider`, `git_repository`, `container_registry`, `caddy_instance`, `webhook_delivery`

Improve:
- Do not store both encrypted secrets and secret references for the same credential path in infra tables.
- Standardize on `secret_reference_id` to resolve secret material.
- Add unique constraints where expected (for example provider/install tuple uniqueness per org).

## 3.5 Secrets & Env Vars

Keep:
- `secret_provider_binding`, `secret_reference`, `deployment_secret_snapshot`, `environment_variable`

Improve:
- Define a single source of truth for secret values (`secret_reference` + provider), with optional encrypted fallback row type.
- Keep `environment_variable` as key metadata + pointer, not mixed secret storage duplication.
- Store snapshot payload encrypted at rest and versioned.

## 3.6 Domains / Backups / Ops

Keep:
- `custom_domain`, `backup`, `backup_schedule`, `notification_channel`, `audit_log`

Improve:
- Promote currently implicit domain routing semantics to explicit columns where stable.
- Add domain ownership/routing verification states with clear lifecycle.
- Ensure backup records distinguish local artifact status vs remote upload status.

## 3.7 Observability

Keep:
- `resource_metric`, `resource_metric_hourly`, `scheduled_task_execution`

Improve:
- Partition strategy and retention are first-class.
- Indexed read path: `(resource_id, timestamp desc)`.
- Keep high-volume append-only tables isolated from control-plane entities.

---

## 4) File/Module Restructure (Schema Code Quality)

Current module grouping is hard to reason about. Use this target structure:

1. `schema/auth/*`
2. `schema/tenancy/*`
3. `schema/resource/*`
4. `schema/deployment/*`
5. `schema/infrastructure/*`
6. `schema/secrets/*`
7. `schema/domains/*`
8. `schema/backups/*`
9. `schema/observability/*`
10. `schema/ops/*` (audit + notifications only)

This reduces mixed responsibility and makes ownership clear.

---

## 5) Data Standards (Must Apply Everywhere)

1. IDs: keep text IDs if already pervasive, but standardize generator and length.
2. Timestamps: all domain tables use `created_at`, `updated_at`; optional `deleted_at` only where soft-delete is required.
3. FK policy:
- `onDelete: cascade` for strict child rows.
- `onDelete: set null` only when the row can logically survive parent removal.
4. Unique/index policy:
- Always index tenant + lookup path.
- Add business uniques explicitly (name/slug/scope keys).
5. Enums:
- Single owner file per enum group, avoid duplicates/synonyms.

---

## 6) Migration Plan (No Big Bang)

### Phase 0: Freeze + Contract
1. Freeze new schema fields except urgent fixes.
2. Approve this target model and mapping.

### Phase 1: Additive v2 Tables
1. Create new normalized tables (`resource`, `resource_runtime_config`, `resource_build_config`, etc.).
2. Add constraints and indexes from day one.

### Phase 2: Backfill
1. Backfill v2 from current tables.
2. Validate row counts, referential integrity, and checksum comparisons.

### Phase 3: Dual Write
1. Write to both old and new paths.
2. Add observability for divergence detection.

### Phase 4: Read Cutover
1. Move reads to v2 tables behind feature flag.
2. Burn in with production traffic.

### Phase 5: Old Path Decommission
1. Remove old reads/writes.
2. Archive/drop deprecated columns/tables in controlled migrations.

---

## 7) Acceptance Criteria

1. `project_resource` no longer carries cross-domain nullable config sprawl.
2. Schema files are domain-grouped with clear ownership.
3. Tenant filtering on every tenant-owned table is index-backed.
4. No duplicate secret storage patterns for the same credential path.
5. Deployment, backup, and domain flows are representable without ambiguous JSON-only fields.
6. Backfill + dual-write validation shows zero drift before cutover.

---

## 8) Immediate Next Actions

1. Create an ADR from this plan and lock table naming decisions.
2. Produce explicit old→new mapping for every affected column.
3. Generate first migration set (additive only) for resource model split.
4. Implement validation script for backfill parity checks.

