# Backups, Schedules & Restore

**Status:** Design proposal (not yet implemented — UI is fully mocked, zero backend exists)

**Last verified:** 2026-05-30

**TL;DR:** The Backups page is a 2,289-line fully-mocked UI. Landing real APIs is greenfield:
add four Drizzle tables, an org-scoped `backups` oRPC router, a `cron.backup-scheduler` +
`backup.run` BullMQ job split (stub in `packages/jobs`, real engine builder-style), and a
destination/storage layer. Architecturally this is "deployments again" — every primitive we need
already exists. The one genuine unknown is how the execution worker reaches DB containers across
Swarm nodes.

---

## Table of contents

1. [Starting point](#1-starting-point)
2. [Mental model](#2-mental-model)
3. [The contract the UI already dictates](#3-the-contract-the-ui-already-dictates)
4. [How competitors do it](#4-how-competitors-do-it)
5. [Data model](#5-data-model)
6. [API surface](#6-api-surface)
7. [Jobs & execution](#7-jobs--execution)
8. [Hard parts / open decisions](#8-hard-parts--open-decisions)
9. [Phasing](#9-phasing)
10. [Where this lives in code](#10-where-this-lives-in-code)

---

## 1. Starting point

`apps/web/src/routes/_app/$orgSlug/backups.tsx` is fully mocked. Its own header comment:
*"All data is currently mocked… Wiring to a real backup / schedule / destination API is a
follow-up."* That follow-up is this doc.

There is **zero backend** for backups today — a repo-wide search found no `backup`, `restic`,
`pg_dump`, `snapshot`, or `s3` code outside `research/`. So "landing real APIs" means: DB tables →
oRPC router → BullMQ jobs → an execution engine → wire the UI off mocks.

The good news: every load-bearing pattern already exists for **deployments**, and we copy that idiom.

---

## 2. Mental model

Three layers, kept separate (same discipline as
[Networking & Domains](./cloudflare-domain-connect-relay.md)):

- **Control plane (otterdeploy)** — Postgres rows describing *desired* and *historical* state:
  destinations (where backups go), schedules (when/what + retention policy), and one `backup` row
  per run. Managed via oRPC, edited in the dashboard.
- **Scheduler** — a single repeatable BullMQ cron job that scans `backup_schedule` for rows due now
  and enqueues execution jobs. The DB stays the source of truth for cron + retention, so user edits
  take effect without reconfiguring BullMQ schedulers.
- **Execution plane** — a worker (builder-style) that resolves credentials at run time, dumps the
  source via the Docker client, compresses + checksums, uploads to the destination, streams logs to
  Redis, writes the result row, and prunes per the forget-policy.

Control-plane writes never touch live data; they enqueue jobs. The execution plane is the only thing
that runs `pg_dump`, `tar`, or `rclone`.

---

## 3. The contract the UI already dictates

The mock fixes the output shapes. Three entities + three flows.

### 3.1 Entities

**Backup** (one run) — `id, source, kind (database|volume|stack), project, when/whenAbs, duration,
sizeMB, sourceSizeMB, compressedSizeMB, destination, encryption, status
(succeeded|failed|running|queued), method, checksum, retention class, sourceService, sourceHost,
log: string[], error?`.

**Schedule** — `id, name, sources[], cron + cronHuman, retention (keep daily/weekly/monthly/yearly),
destination, encryption, pitr, enabled, lastRun/lastRunStatus, nextRun`.

**Destination** — `id, name, uri, kind (s3|local|sftp), usedGB/totalGB, encryption,
status (active|degraded)`.

### 3.2 Flows

- **Backup now** — kind, source, destination, encrypt toggle → enqueue one run.
- **Schedule editor** — cron presets (hourly/daily/weekly/monthly/custom) + retention counts +
  pre-backup hook + notification channel.
- **Restore wizard** — three modes: `download` (presigned URL), `as-new` (provision into a project),
  `in-place` (destructive, typed-name confirm) — with a checksum/integrity verify step.

Row actions (restore, download, delete) are all disabled unless `status === "succeeded"`.

These give us the `.output()` zod shapes almost for free.

---

## 4. How competitors do it

All three converge on the same architecture; we steal the best of each.

**Dokploy** (closest — TS + Drizzle, `research/dokploy/packages/server/src/db/schema/`):
- `backups` + `volume-backups` tables, both FK → a `destinations` table (S3-compatible:
  bucket/region/encrypted creds, with a per-backup `prefix`).
- `schedule: string` cron; a **separate schedule service** (`Dockerfile.schedule`) fires crons and
  calls a jobs API (`/create-backup`, `/update-backup`, `/remove-job`).
- Execution: `pg_dump`/`mysqldump`/`mongodump`/`redis BGSAVE`; volumes via `tar` + **rclone** to S3.
- Restore (`utils/volume-backups/restore.ts`): download via rclone, **check the volume isn't in
  use** (Docker label filter) before extracting.
- Retention: simple `keepLatestCount`.

**Coolify** (richest retention — copy this, `research/coolify/app/`):
- `ScheduledDatabaseBackup` + separate `ScheduledDatabaseBackupExecution` (status/message/size/
  filename/finished_at + `s3_uploaded`, `local_storage_deleted`, `s3_storage_deleted` flags).
- Retention is **count + days + max-storage-GB**, tracked separately for local vs S3
  (`disable_local_backup` = S3-only).
- `DatabaseBackupJob`: `onQueue('high')`, **`WithoutOverlapping`** (no concurrent backup of the same
  DB), `ShouldBeEncrypted`, `timeout` (default 3600s) + `expireAfter = timeout + 300`. Reads DB creds
  at run time via `docker exec <container> env | grep POSTGRES_|MYSQL_`. Emits `BackupCreated` then
  `BackupSuccess`/`BackupFailed`.

**Slipway** (`research/slipway/`): minimal — one `Backup` model, quest job every 1 min with
`withoutOverlapping`, `retentionCount` default 10.

**Adopted decisions:** separate *schedule config* from *execution rows*; retention as
count+days+storage (Coolify); no-overlap guard per resource; resolve DB creds at run time; restore
guards against an in-use target.

---

## 5. Data model

New file `packages/db/src/schema/backup.ts`. Conventions copied from existing schema: prefixed CUID2
ids via `createId(ID_PREFIX.x)`, `createdAt`/`updatedAt` with `$onUpdate`, `pgEnum` for unions,
`jsonb` for flexible config, FK `onDelete: cascade`. Add id prefixes `backup`, `baksched`, `bakdest`
to `packages/shared/src/id.ts`.

### `backup_destination`
`id`, `organizationId` (FK org, cascade), `name`, `type` enum `s3|local|sftp`, `config` jsonb
(bucket / region / endpoint / prefix), `encryptedSecret` (AES-GCM at rest — copy the
`containerRegistry` crypto; **do not** store plaintext like Dokploy), `status` enum `active|degraded`,
timestamps. Index on `organizationId`.

### `backup_schedule`
`id`, `organizationId`, optional `projectId`, `name`, `sources` jsonb (resource refs), `cron` text,
retention columns (`keepDaily`, `keepWeekly`, `keepMonthly`, `keepYearly`, optional `retentionDays`,
`maxStorageGb`), `destinationId` FK (`onDelete: restrict`), `encryption` enum, `pitr` bool, `enabled`
bool, `preHook` text, `notifyChannel` text, `lastRunAt`, `nextRunAt`, timestamps.

### `backup` (one row per run)
`id`, `organizationId`, `resourceId` FK, `scheduleId` FK **nullable** (null = manual "backup now"),
`kind` enum `database|volume|stack`, `status` enum `queued|running|succeeded|failed`, `method`,
`destinationId`, `encryption`, `sourceSizeBytes`/`compressedSizeBytes` (`bigint`), `checksum`,
`storagePath` (S3 key / local path), `retention` class, `durationMs`, `errorMessage`, `startedAt`,
`completedAt` (only on terminal), timestamps. Indexes on `resourceId`, `scheduleId`, `status`.

### `backup_log`
Clone of `deploymentLog` (`packages/db/src/schema/build.ts`): `seq bigserial PK`, `backupId` FK
(cascade), `stream` enum `stdout|stderr|system`, `line` text, `ts`. Index `(backupId, seq)` for
paginated scrollback.

The `databaseResource` table (`schema/project.ts`) already holds the engine enum
(`postgres/redis/mariadb/mongodb`), creds, and internal/upstream host:port — that row **is** the
backup source; we already know how to reach each DB.

---

## 6. API surface

`packages/api/src/routers/backups/` — `contract.ts` + `index.ts` + `service.ts` + `errors.ts`,
mirroring the `env` router. Handlers use `orgScopedProcedure`, call `context.log.set({ target })`
first, return `Result<T,E>` from the service, and dispatch typed errors with `matchError`. **No raw
try/catch** — `Result.tryPromise` with a non-throwing catch.

- `backups.list` (filters: projectId, kind, destinationId, search) · `backups.get` · `backups.delete`
- `backups.run` (backup-now) · `backups.logs` (async-generator stream, reuse deployment log-stream)
- `backups.downloadUrl` (presigned) · `backups.restore` (`mode: download|as-new|in-place`)
- `backups.schedules.{list,create,update,delete,toggle,runNow}`
- `backups.destinations.{list,create,update,delete,test}`

Errors (`TaggedError`): `BackupNotFoundError`, `DestinationNotFoundError`, `DestinationInUseError`,
`RestoreTargetBusyError`, `BackupDatabaseError`.

Register `backups: backupsRouter` in `packages/api/src/routers/index.ts`.

---

## 7. Jobs & execution

`packages/jobs/src/jobs/backup.ts` + `registry.ts` + `triggers.ts`, following the deploy pattern
(stub in `packages/jobs`, real pipeline in a builder-style worker via `apps/builder/src/handler.ts`).

- **`backup.run`** — payload `{ backupId, resourceId, destinationId, kind }`. opts: `attempts` +
  exponential backoff + retention windows. Real handler: resolve creds at run time → dump via the
  `@otterdeploy/docker` client (`docker exec` into the source container) → compress → sha256 →
  upload to destination → update `backup` row + emit logs to Redis → enforce forget-policy pruning.
  No-overlap guard per `resourceId` (Coolify's `WithoutOverlapping`), via a Redis lock or a BullMQ
  job id keyed on the resource.
- **`cron.backup-scheduler`** — repeatable (`cron` field → `queue.upsertJobScheduler` in
  `workers.ts`, as `hourly-cleanup` already does). Scans `backup_schedule` for `nextRunAt <= now`,
  enqueues `backup.run`, advances `nextRunAt`. One scanning cron (not per-schedule schedulers) so the
  DB stays the source of truth — Dokploy's split.

Live "running now" rows and the detail-panel log come free from
`packages/api/src/routers/deployment/log-stream.ts` (Redis pub/sub + DB scrollback as an async
generator).

---

## 8. Hard parts / open decisions

1. **Execution transport on Swarm** *(biggest unknown — decide before building the engine).* The
   `server` table is Swarm (manager/worker, `host`); DB containers run as services on a *specific
   node*. The worker must reach the node running the source container — either node-addressed Docker
   access or a per-server agent. Coolify/Dokploy assume SSH/agent access per server.
2. **Volume & stack backups are harder than DB dumps.** DB dumps are a clean `docker exec`. Volumes
   need `tar`/`restic` against a possibly-running volume. "Stack" backups can be cheap **DB-side**
   snapshots — we already store `project.manifest` + `stackFile` (`schema/project.ts`) — rather than
   shelling out.
3. **Encryption modes & PITR.** The mock offers `AES-256 GCM`, `KMS-managed`, `customer-key`, and a
   PITR toggle. v1: AES-256-GCM only (reuse registry crypto); treat KMS / customer-key / PITR as later.
4. **Presigned download** needs the destination's S3 client to mint URLs — trivial once a destination
   client exists.
5. **Restore safety.** The in-place path is destructive; the typed-name confirm is UI-only today and
   **must be enforced server-side**, plus an in-use guard before overwrite (`RestoreTargetBusyError`).

---

## 9. Phasing

| Phase | Scope | Risk |
| --- | --- | --- |
| 1 | Schema + migration (`backup`, `backup_schedule`, `backup_destination`, `backup_log`) + id prefixes | low |
| 2 | Read-only API (`list`/`get` for all three) + wire UI table/cards/stats off real data — kills the mocks | low |
| 3 | Destinations CRUD + `test` (encrypted S3 creds) | medium |
| 4 | Backup-now + real engine for `database/postgres` only, end to end with live logs; then redis/mysql/mongo | high (§8.1) |
| 5 | Schedules + scheduler cron + retention/forget-policy + no-overlap | medium |
| 6 | Restore (`download` → `as-new` → `in-place`) + volume/stack kinds | high |

---

## 10. Where this lives in code

Nothing below exists yet — it is the planned layout, mirroring the `env`/`project`/`docker` routers
and the `deployment` job split.

| Concern | Package / file (planned) | Mirrors |
| --- | --- | --- |
| DB schema | `packages/db/src/schema/backup.ts` | `schema/project.ts` (deployment), `schema/build.ts` (deploymentLog) |
| Id prefixes | `packages/shared/src/id.ts` (`backup`, `baksched`, `bakdest`) | existing `ID_PREFIX` |
| Contract | `packages/api/src/routers/backups/contract.ts` | `routers/docker/contract.ts` |
| Handlers | `packages/api/src/routers/backups/index.ts` | `routers/env/index.ts` (org-scoped) |
| Service / queries | `packages/api/src/routers/backups/service.ts` | `routers/env/handlers.ts` |
| Errors | `packages/api/src/routers/backups/errors.ts` | `routers/project/errors.ts` |
| Router registration | `packages/api/src/routers/index.ts` (`backups: backupsRouter`) | existing barrel |
| Log streaming | reuse `packages/api/src/routers/deployment/log-stream.ts` | — |
| Job stubs + triggers | `packages/jobs/src/jobs/backup.ts`, `registry.ts`, `triggers.ts` | `jobs/deploy.ts`, `jobs/hourly-cleanup.ts` |
| Real engine | a worker (in `apps/builder` or a sibling) that overrides the stub | `apps/builder/src/handler.ts` |
| Frontend (de-mock) | `apps/web/src/routes/_app/$orgSlug/backups.tsx` | `routes/_app/$orgSlug/$projectSlug/variables.tsx` (recent real-API port) |
