import type {
  BackupDestinationId,
  BackupId,
  BackupRestoreId,
  BackupScheduleId,
  BackupVerificationId,
  OrganizationId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

/**
 * Backups schema: destinations, schedules, runs, and run logs.
 *
 * Three control-plane tables describe desired + historical backup state, plus
 * an append-only log stream cloned from `deploymentLog`. The execution plane
 * (a builder-style worker) is the only thing that runs `pg_dump`/`tar`/`rclone`;
 * these rows only ever describe what should happen and what did happen.
 *
 *   backup_destination: where backups go (S3 / local disk / SFTP). S3 creds
 *     are stored encrypted via `encryptSecret` (AES-GCM keyed off
 *     BETTER_AUTH_SECRET: see packages/api/src/lib/crypto.ts). Never store
 *     plaintext secrets here.
 *
 *   backup_schedule: when + what to back up, with a retention policy. A single
 *     scanning cron (cron.backup-scheduler) reads these rows so user edits take
 *     effect without reconfiguring BullMQ schedulers: the DB is the source of
 *     truth for cron + retention.
 *
 *   backup: one row per run (manual "backup now" or scheduler-enqueued). Holds
 *     terminal result: status, sizes, checksum, storage path, error.
 *
 *   backup_log: append-only per-run output, one line per row (clone of
 *     deploymentLog). Lets the detail panel paginate + live-tail via Redis
 *     pub/sub without scanning a JSONB blob.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { project, resource } from "./project";

// ---------------------------------------------------------------------------
// Enums (shared across backup tables)
// ---------------------------------------------------------------------------

export const backupDestinationTypeEnum = pgEnum("backup_destination_type", [
  "s3",
  "local",
  "sftp",
  "azblob",
  "gcs",
]);

/**
 * `disabled` is operator intent, not a health signal: the scheduler skips a
 * disabled destination when fanning a run out (see backups/scheduler.ts), so it
 * stops receiving backups while its existing snapshots and history stay
 * readable/restorable. `degraded` is a health signal and still runs.
 */
export const backupDestinationStatusEnum = pgEnum("backup_destination_status", [
  "active",
  "degraded",
  "disabled",
]);

/**
 * What a run backs up. `database` = logical dump of a database resource;
 * `volume` = tar archive of a named Docker volume (helper container, read-only
 * mount). `stack` is a reserved value with NO engine behind it. Nothing ever
 * writes it and the contract/UI no longer offer it; it stays in the pg enum
 * only because removing an enum value is a type-rebuild migration.
 */
export const backupKindEnum = pgEnum("backup_kind", ["database", "volume", "stack"]);

export const backupStatusEnum = pgEnum("backup_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

/**
 * How the archive is produced. `logical` = engine dump (pg_dump/mysqldump/
 * mongodump). `physical` = pg_basebackup tar of the whole cluster (postgres
 * only): restores by extracting into a fresh data directory, so in-place
 * restore and sandbox verification are refused for it. Continuous protection
 * (WAL archiving + PITR) is the follow-up on top of this
 * (docs/designs/continuous-protection.md).
 */
export const backupApproachEnum = pgEnum("backup_approach", ["logical", "physical"]);

/**
 * Encryption-at-rest mode applied to the produced archive. v1 only implements
 * `aes-256-gcm` (reuses the registry crypto) and `none`; `kms-managed` and
 * `customer-key` are reserved for later and rejected by the engine for now.
 */
export const backupEncryptionEnum = pgEnum("backup_encryption", [
  "none",
  "aes-256-gcm",
  "kms-managed",
  "customer-key",
]);

export const backupRetentionClassEnum = pgEnum("backup_retention_class", [
  "short",
  "standard",
  "long",
  "archive",
]);

export const backupLogStreamEnum = pgEnum("backup_log_stream", ["stdout", "stderr", "system"]);

/**
 * Restore-proving verification lifecycle. A verification run restores the
 * snapshot into a throwaway container and inspects the result; `passed` means
 * the dump actually restores, not merely that the repo is intact (that cheaper
 * structural check remains the `verify` endpoint).
 */
export const backupVerificationStatusEnum = pgEnum("backup_verification_status", [
  "queued",
  "running",
  "passed",
  "failed",
]);

export const backupVerificationTriggerEnum = pgEnum("backup_verification_trigger", [
  "manual",
  "after-backup",
]);

/** Denormalized latest-verification badge on the run row (list views read it
 *  without a lateral join; the verification row remains the source of detail). */
export const backupVerifiedStatusEnum = pgEnum("backup_verified_status", [
  "none",
  "running",
  "passed",
  "failed",
]);

export const backupRestoreStatusEnum = pgEnum("backup_restore_status", [
  "running",
  "succeeded",
  "failed",
]);

export const backupRestoreModeEnum = pgEnum("backup_restore_mode", ["download", "in-place"]);

// ---------------------------------------------------------------------------
// backup_destination: where backups are stored
// ---------------------------------------------------------------------------

/**
 * `config` holds non-secret connection params (bucket / region / endpoint /
 * prefix for S3, or `path` for local). `encryptedSecret` is the AES-GCM
 * ciphertext blob (access key + secret, or SFTP key): base64url, never logged,
 * nullable because `local` destinations have no secret.
 */
export const backupDestination = pgTable(
  "backup_destination",
  {
    id: text("id")
      .primaryKey()
      .$type<BackupDestinationId>()
      .$defaultFn(() => createId(ID_PREFIX.backupDestination)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: backupDestinationTypeEnum("type").notNull(),
    config: jsonb("config").$type<JsonObject>().notNull().default({}),
    encryptedSecret: text("encrypted_secret"),
    status: backupDestinationStatusEnum("status").notNull().default("active"),
    /**
     * The platform-owned local destination every org gets, so a fresh install
     * can schedule a backup without first inventing a host path. Its `config`
     * (path + org prefix) is owned by ensureManagedLocalDestination and is NOT
     * user-editable; it cannot be deleted, only disabled, and only while
     * another active destination exists. At most one per org. Enforced by the
     * partial unique index below, which is also what makes the ensure path
     * safe to call concurrently.
     */
    managed: boolean("managed").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("backup_destination_org_idx").on(table.organizationId),
    uniqueIndex("backup_destination_managed_org_idx")
      .on(table.organizationId)
      .where(sql`${table.managed}`),
  ],
);

// ---------------------------------------------------------------------------
// backup_schedule: when + what + retention policy
// ---------------------------------------------------------------------------

export const backupSchedule = pgTable(
  "backup_schedule",
  {
    id: text("id")
      .primaryKey()
      .$type<BackupScheduleId>()
      .$defaultFn(() => createId(ID_PREFIX.backupSchedule)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Null = org-wide schedule not scoped to a single project.
    projectId: text("project_id")
      .$type<ProjectId>()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Resource refs this schedule backs up (resource ids or source names).
    sources: jsonb("sources").$type<string[]>().notNull().default([]),
    cron: text("cron").notNull(),
    // Retention windows: count-based tiers plus optional
    // age (days) and storage (GB) ceilings, enforced by the forget-policy.
    // `keepLast` (most-recent N regardless of bucket) and `keepHourly` extend
    // the GFS ladder downward for tight-RPO schedules.
    keepLast: integer("keep_last").notNull().default(0),
    keepHourly: integer("keep_hourly").notNull().default(0),
    keepDaily: integer("keep_daily").notNull().default(0),
    keepWeekly: integer("keep_weekly").notNull().default(0),
    keepMonthly: integer("keep_monthly").notNull().default(0),
    keepYearly: integer("keep_yearly").notNull().default(0),
    retentionDays: integer("retention_days"),
    maxStorageGb: integer("max_storage_gb"),
    // Storage destinations this schedule fans each run out to (a single dump is
    // copied to every id). No FK: like `sources`, it's a jsonb id array;
    // referential integrity is enforced at write time in the router.
    destinationIds: jsonb("destination_ids").$type<BackupDestinationId[]>().notNull().default([]),
    encryption: backupEncryptionEnum("encryption").notNull().default("aes-256-gcm"),
    // NOTE: former `pitr` + `notify_channel` columns were dropped as vestigial,
    // no PITR capability exists in the engine (logical dumps only, no WAL
    // archiving), and failure alerts route through the platform-event matrix
    // (backup.failed → Notifications), not per-schedule channels.
    enabled: boolean("enabled").notNull().default(true),
    preHook: text("pre_hook"),
    /** Bounded retry for failed scheduled runs: a failed (source × destination)
     *  run is re-attempted up to this many extra times within the same
     *  schedule pass, with a short backoff between attempts. 0 = off. */
    maxRetries: integer("max_retries").notNull().default(0),
    /** Run a restore-proving verification of each successful run's snapshot
     *  right after it completes (throwaway container + pg_restore + checks). */
    verifyAfterBackup: boolean("verify_after_backup").notNull().default(false),
    /**
     * Overdue alerting: emit `backup.overdue` when the schedule's newest
     * successful run is older than this many hours. Null = derive the
     * threshold from the cron cadence (2× the fire interval), so alerts work
     * without configuration. `overdueNotifiedAt` dedupes the alert to one per
     * overdue episode; a subsequent success clears it.
     */
    overdueAfterHours: integer("overdue_after_hours"),
    overdueNotifiedAt: timestamp("overdue_notified_at"),
    lastRunAt: timestamp("last_run_at"),
    lastRunStatus: backupStatusEnum("last_run_status"),
    nextRunAt: timestamp("next_run_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("backup_schedule_org_idx").on(table.organizationId),
    // Hot path for the scanning cron: "schedules due now".
    index("backup_schedule_next_run_idx").on(table.enabled, table.nextRunAt),
  ],
);

// ---------------------------------------------------------------------------
// backup: one row per run
// ---------------------------------------------------------------------------

export const backup = pgTable(
  "backup",
  {
    id: text("id")
      .primaryKey()
      .$type<BackupId>()
      .$defaultFn(() => createId(ID_PREFIX.backup)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Source discriminator: exactly one of `resourceId` / `volumeName` is set.
    // kind=database ⇒ resourceId (FK, cascade, a deleted DB takes its run
    // history with it). kind=volume ⇒ volumeName (no FK: Docker volumes are
    // daemon objects, not rows; the name is resolved against the daemon at
    // execution time and the run row outlives the volume).
    resourceId: text("resource_id")
      .$type<ResourceId>()
      .references(() => resource.id, { onDelete: "cascade" }),
    volumeName: text("volume_name"),
    // Null = manual "backup now"; set = produced by a schedule.
    scheduleId: text("schedule_id")
      .$type<BackupScheduleId>()
      .references(() => backupSchedule.id, { onDelete: "set null" }),
    kind: backupKindEnum("kind").notNull().default("database"),
    status: backupStatusEnum("status").notNull().default("queued"),
    approach: backupApproachEnum("approach").notNull().default("logical"),
    // e.g. "pg_dump --format=custom -Z9".
    method: text("method"),
    destinationId: text("destination_id")
      .notNull()
      .$type<BackupDestinationId>()
      .references(() => backupDestination.id, { onDelete: "restrict" }),
    encryption: backupEncryptionEnum("encryption").notNull().default("aes-256-gcm"),
    // Result-size columns, REPURPOSED for the rustic engine (no migration, the
    // physical columns are reused with new semantics; see
    // packages/api/src/backups/{engine,db}.ts markBackupSucceeded):
    //   sourceSizeBytes     = rustic summary.total_bytes_processed (dump size).
    //   compressedSizeBytes = rustic summary.data_added: bytes ADDED to the repo
    //     this run (post-dedup + zstd), NOT a standalone compressed archive size;
    //     with incremental dedup an unchanged source can add ~0 bytes.
    sourceSizeBytes: bigint("source_size_bytes", { mode: "number" }),
    compressedSizeBytes: bigint("compressed_size_bytes", { mode: "number" }),
    // REPURPOSED: no longer a sha256 of the stored blob. rustic owns integrity
    // (structural `check` in verifyBackup), so the engine writes null here today;
    // a short snapshot id may be stored later. Do not treat as a content hash.
    checksum: text("checksum"),
    // REPURPOSED: was the S3 key / local path of the produced archive; now holds
    // the rustic SNAPSHOT ID (64-hex, from backup JSON `.id`). Combined with the
    // (resource × destination) repo derivation it fully addresses the snapshot
    // for dump/restore/forget: there is no per-run file path anymore.
    storagePath: text("storage_path"),
    retention: backupRetentionClassEnum("retention").notNull().default("standard"),
    durationMs: integer("duration_ms"),
    /** 1-based attempt number: >1 marks a scheduler retry of a failed run
     *  (same source × destination, fresh row so each attempt keeps its logs). */
    attempt: integer("attempt").notNull().default(1),
    /** Latest restore-proving verification outcome for this run (denormalized
     *  from backup_verification for cheap list rendering). */
    verifiedStatus: backupVerifiedStatusEnum("verified_status").notNull().default("none"),
    verifiedAt: timestamp("verified_at"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    // Set only on a terminal (succeeded|failed) transition.
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("backup_org_idx").on(table.organizationId),
    index("backup_resource_idx").on(table.resourceId),
    index("backup_schedule_idx").on(table.scheduleId),
    index("backup_status_idx").on(table.status),
  ],
);

// ---------------------------------------------------------------------------
// backup_log: append-only per-run output (clone of deploymentLog)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// backup_lock: single-in-flight claim per backup source
// ---------------------------------------------------------------------------

/**
 * At most one active backup per source (databasus's claim pattern): the engine
 * INSERTs the source scope ON CONFLICT DO NOTHING before dumping and deletes
 * the row when the run settles. A second run of the same source, manual or
 * scheduled, fails fast with a clear message instead of double-dumping the
 * database. `claimedAt` exists so the boot-time reaper can clear locks
 * orphaned by a crash (the claim is process-local work, not durable intent).
 */
export const backupLock = pgTable("backup_lock", {
  /** Source scope: the resource id for database/stack runs, `volume-<name>`
   *  for volume runs (same derivation as the repo scope). */
  scope: text("scope").primaryKey(),
  backupId: text("backup_id")
    .notNull()
    .$type<BackupId>()
    .references(() => backup.id, { onDelete: "cascade" }),
  claimedAt: timestamp("claimed_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// backup_verification: restore-proving verification runs
// ---------------------------------------------------------------------------

/**
 * One row per verification run. The engine restores the snapshot into a
 * throwaway container (same image as the source) and inspects the result;
 * `checks` holds the collected evidence (restored size, table count, per-table
 * row counts, size ratio) so the UI can show *why* a backup is trusted, not
 * just a green dot.
 */
export const backupVerification = pgTable(
  "backup_verification",
  {
    id: text("id")
      .primaryKey()
      .$type<BackupVerificationId>()
      .$defaultFn(() => createId(ID_PREFIX.backupVerification)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    backupId: text("backup_id")
      .notNull()
      .$type<BackupId>()
      .references(() => backup.id, { onDelete: "cascade" }),
    status: backupVerificationStatusEnum("status").notNull().default("queued"),
    trigger: backupVerificationTriggerEnum("trigger").notNull().default("manual"),
    /** Evidence bag: restoredSizeBytes, tableCount, schemaCount, rowCounts
     *  (top tables), sizeRatio. Shape owned by verify-restore.ts. */
    checks: jsonb("checks").$type<JsonObject>(),
    failMessage: text("fail_message"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("backup_verification_backup_idx").on(table.backupId, table.createdAt)],
);

// ---------------------------------------------------------------------------
// backup_restore: persisted restore runs (history + status)
// ---------------------------------------------------------------------------

/**
 * One row per restore attempt, so restores have history and observable status
 * instead of living only inside a blocking RPC. Written by restoreBackup
 * around its existing execution path; failure keeps the error message.
 */
export const backupRestore = pgTable(
  "backup_restore",
  {
    id: text("id")
      .primaryKey()
      .$type<BackupRestoreId>()
      .$defaultFn(() => createId(ID_PREFIX.backupRestore)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    backupId: text("backup_id")
      .notNull()
      .$type<BackupId>()
      .references(() => backup.id, { onDelete: "cascade" }),
    mode: backupRestoreModeEnum("mode").notNull(),
    /** Set when the restore wrote into a different database than the
     *  snapshot's source (`targetResourceId` flows). */
    targetResourceId: text("target_resource_id").$type<ResourceId>(),
    status: backupRestoreStatusEnum("status").notNull().default("running"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("backup_restore_backup_idx").on(table.backupId, table.createdAt)],
);

export const backupLog = pgTable(
  "backup_log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    backupId: text("backup_id")
      .notNull()
      .$type<BackupId>()
      .references(() => backup.id, { onDelete: "cascade" }),
    stream: backupLogStreamEnum("stream").notNull(),
    line: text("line").notNull(),
    ts: timestamp("ts").defaultNow().notNull(),
  },
  (table) => [
    // "give me lines for backup X after seq Y", ordering + pagination cursor.
    index("backup_log_backup_seq_idx").on(table.backupId, table.seq),
  ],
);
