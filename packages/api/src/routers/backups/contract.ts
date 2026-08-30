/**
 * Backups oRPC contract: read surface (Phase 2) plus destinations CRUD
 * (Phase 3) and the run/logs execution surface (Phase 4). Mirrors the env
 * contract: `createSelectSchema` for outputs, `zId(...)` branded id inputs,
 * a stable `tag`/`basePath` for the generated OpenAPI doc.
 *
 * Outputs are the raw DB rows (timestamps + bytes + structured retention)
 * enriched with the few joined display fields the UI can't derive
 * (resource/project names, destination name, db host). The web route maps
 * those raw values into its display shapes (relative `when`, `sizeMB`, …).
 */
import { oc } from "@orpc/contract";
import { backup, backupDestination, backupSchedule } from "@otterdeploy/db/schema";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { validateCron } from "../../lib/cron";
import { zJsonObject } from "../../lib/z-json";
import { projectIdField, resourceIdField } from "../project/contract/shared";
import { volumeNameField } from "../volumes/contract";

const tag = "backups";
const basePath = "/backups";

const backupIdField = zId(ID_PREFIX.backup);
const backupScheduleIdField = zId(ID_PREFIX.backupSchedule);
const backupDestinationIdField = zId(ID_PREFIX.backupDestination);
const backupVerificationIdField = zId(ID_PREFIX.backupVerification);
const backupRestoreIdField = zId(ID_PREFIX.backupRestore);

/** Cron expressions are validated at the boundary: an unparseable expression
 *  would otherwise be accepted, silently null the schedule's nextRunAt, and
 *  dead-end it forever with a green-looking row. The same parser drives
 *  scheduler math, so valid-here always means fires-there, and the error
 *  carries a field-level reason. */
const cronField = z
  .string()
  .min(1)
  .check((ctx) => {
    const valid = validateCron(ctx.value);
    if (valid.isErr()) {
      ctx.issues.push({ code: "custom", message: valid.error.message, input: ctx.value });
    }
  });

// "stack" exists only as a reserved DB-enum value with no engine. It is
// deliberately NOT offered here (or in the UI filter).
const backupKind = z.enum(["database", "volume"]);
const destinationType = z.enum(["s3", "local", "sftp", "azblob", "gcs"]);

// ─── Output schemas ────────────────────────────────────────────────────

/** One backup run, enriched with joined display fields. */
export const backupSchema = createSelectSchema(backup).extend({
  id: backupIdField,
  // Null for volume runs (whose source is `volumeName` instead).
  resourceId: resourceIdField.nullable(),
  // Joined, display-only (nullable: a queued run may not have resolved yet).
  source: z.string().nullable(),
  project: z.string().nullable(),
  sourceService: z.string().nullable(),
  sourceHost: z.string().nullable(),
  destinationName: z.string().nullable(),
  destinationType: destinationType.nullable(),
});

export const scheduleSchema = createSelectSchema(backupSchedule).extend({
  id: backupScheduleIdField,
  // drizzle-zod can't recover `.$type<…[]>()` off jsonb columns; restate them
  // so the output types are real arrays, not `$strip[]`.
  sources: z.array(z.string()),
  destinationIds: z.array(backupDestinationIdField),
  // Resolved names for `destinationIds`, in the same order (best-effort).
  destinationNames: z.array(z.string()),
  // Source refs that no longer resolve to a live database resource. Non-empty ⇒
  // the schedule is orphaned (its DB was deleted) and can't run until repaired.
  missingSources: z.array(z.string()),
});

/**
 * One thing an operator can back up.
 *
 * `origin` distinguishes the two primitives that both really are databases:
 * a managed `database_resource`, and a compose stack's `db` service. On most
 * installs every database is the latter, so a picker that offers only the
 * former offers nothing at all.
 */
export const backupSourceSchema = z.object({
  resourceId: resourceIdField,
  name: z.string(),
  engine: z.string(),
  projectSlug: z.string(),
  projectName: z.string(),
  origin: z.enum(["managed", "stack"]),
});

/** Destination, never exposes `encryptedSecret`; adds computed usage. */
export const destinationSchema = createSelectSchema(backupDestination)
  .omit({ encryptedSecret: true })
  .extend({
    id: backupDestinationIdField,
    config: zJsonObject,
    usedBytes: z.number(),
  });

// ─── Inputs ────────────────────────────────────────────────────────────

const listBackupsInput = z
  .object({
    projectId: projectIdField.optional(),
    kind: backupKind.optional(),
    destinationId: backupDestinationIdField.optional(),
    search: z.string().optional(),
  })
  .optional();

const getBackupInput = z.object({ id: backupIdField });

const backupNotFound = {
  NOT_FOUND: { status: 404 as const, message: "Backup not found" as const },
};

const destinationNotFound = {
  NOT_FOUND: {
    status: 404 as const,
    message: "Destination not found" as const,
  },
};

// The platform-managed local destination refuses deletion and relocation. The
// UI should not offer either affordance on a managed row, so reaching this is
// either a direct API call or a stale client.
const destinationManaged = {
  MANAGED: {
    status: 409 as const,
    message: "Destination is managed by the platform" as const,
    data: z.object({ operation: z.enum(["delete", "reconfigure"]) }),
  },
};

// Disabling the org's last active destination would make every schedule a
// silent no-op, so it's refused rather than allowed-and-warned.
const destinationLastActive = {
  LAST_ACTIVE: {
    status: 409 as const,
    message: "Cannot disable the only active destination" as const,
  },
};

// Structurally incomplete config (e.g. `local` with no `path`), rejected at
// create/update so it can't fail a backup run later.
const destinationInvalidConfig = {
  INVALID_CONFIG: {
    status: 422 as const,
    message: "Destination configuration is incomplete" as const,
    data: z.object({ reason: z.string() }),
  },
};

// Non-secret connection params (bucket / region / endpoint / prefix / path).
const destinationConfigInput = zJsonObject;
// Secret creds (S3 access key + secret, SFTP password/key). Encrypted at
// rest, never returned. Omitted for `local` destinations.
const destinationSecretInput = z.record(z.string(), z.string());

const createDestinationInput = z.object({
  name: z.string().min(1).max(120),
  type: destinationType,
  config: destinationConfigInput.default({}),
  secret: destinationSecretInput.optional(),
});

const updateDestinationInput = z.object({
  id: backupDestinationIdField,
  name: z.string().min(1).max(120).optional(),
  config: destinationConfigInput.optional(),
  // Omit / empty to leave the stored secret in place.
  secret: destinationSecretInput.optional(),
});

const destinationIdInput = z.object({ id: backupDestinationIdField });

const setDestinationEnabledInput = z.object({
  id: backupDestinationIdField,
  enabled: z.boolean(),
});

const testResultSchema = z.object({
  message: z.string(),
});

// ─── Execution + schedule inputs ─────────────────────────────────────────

const runBackupInput = z
  .object({
    // Exactly one source: a database resource, or a named Docker volume.
    resourceId: resourceIdField.optional(),
    volumeName: volumeNameField.optional(),
    // One dump fanned out to every destination: one backup record per id.
    destinationIds: z.array(backupDestinationIdField).min(1),
    encryption: z.enum(["none", "aes-256-gcm"]).default("aes-256-gcm"),
    // `physical` = pg_basebackup cluster tar (postgres databases only).
    approach: z.enum(["logical", "physical"]).default("logical"),
  })
  .refine((v) => (v.resourceId != null) !== (v.volumeName != null), {
    message: "Provide exactly one of resourceId or volumeName",
  })
  .refine((v) => v.approach !== "physical" || v.resourceId != null, {
    message: "Physical backups apply to database resources, not volumes",
  });

const restoreBackupInput = z.object({
  id: backupIdField,
  mode: z.enum(["download", "in-place"]).default("in-place"),
  /** Typed-name confirmation (the name of whatever is OVERWRITTEN, the target
   *  database when one is given). Required for in-place; enforced server-side
   *  so the destructive path can't be called blind. */
  confirm: z.string().optional(),
  /** Restore into this database instead of the one the snapshot came from.
   *  Omitted = restore over the snapshot's own source (the original behaviour).
   *  Engines must match, and a volume snapshot has no database target. */
  targetResourceId: resourceIdField.optional(),
});

const backupLogsInput = z.object({
  id: backupIdField,
  afterSeq: z.number().int().nonnegative().default(0),
});

const backupLogLineSchema = z.object({
  seq: z.number(),
  stream: z.string(),
  line: z.string(),
  ts: z.date(),
});

const createScheduleInput = z.object({
  name: z.string().min(1).max(120),
  sources: z.array(z.string()).default([]),
  cron: cronField,
  destinationIds: z.array(backupDestinationIdField).min(1),
  projectId: projectIdField.optional(),
  // GFS retention tiers: keep the most recent archive per bucket up to N.
  keepLast: z.number().int().nonnegative().default(0),
  keepHourly: z.number().int().nonnegative().default(0),
  keepDaily: z.number().int().nonnegative().default(0),
  keepWeekly: z.number().int().nonnegative().default(0),
  keepMonthly: z.number().int().nonnegative().default(0),
  keepYearly: z.number().int().nonnegative().default(0),
  retentionDays: z.number().int().positive().nullable().default(null),
  maxStorageGb: z.number().int().positive().nullable().default(null),
  preHook: z.string().max(2000).nullable().default(null),
  encryption: z.enum(["none", "aes-256-gcm"]).default("aes-256-gcm"),
  enabled: z.boolean().default(true),
  // Failure handling + trust: bounded retry, restore-proving verification,
  // and the overdue-alert threshold (null = derive from the cron cadence).
  maxRetries: z.number().int().min(0).max(5).default(0),
  verifyAfterBackup: z.boolean().default(false),
  overdueAfterHours: z.number().int().positive().nullable().default(null),
});

const updateScheduleInput = z.object({
  id: backupScheduleIdField,
  name: z.string().min(1).max(120).optional(),
  sources: z.array(z.string()).optional(),
  cron: cronField.optional(),
  destinationIds: z.array(backupDestinationIdField).min(1).optional(),
  keepLast: z.number().int().nonnegative().optional(),
  keepHourly: z.number().int().nonnegative().optional(),
  keepDaily: z.number().int().nonnegative().optional(),
  keepWeekly: z.number().int().nonnegative().optional(),
  keepMonthly: z.number().int().nonnegative().optional(),
  keepYearly: z.number().int().nonnegative().optional(),
  retentionDays: z.number().int().positive().nullable().optional(),
  maxStorageGb: z.number().int().positive().nullable().optional(),
  preHook: z.string().max(2000).nullable().optional(),
  encryption: z.enum(["none", "aes-256-gcm"]).optional(),
  enabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  verifyAfterBackup: z.boolean().optional(),
  overdueAfterHours: z.number().int().positive().nullable().optional(),
});

const scheduleIdInput = z.object({ id: backupScheduleIdField });

const scheduleNotFound = {
  NOT_FOUND: { status: 404 as const, message: "Schedule not found" as const },
};

const scheduleInvalidDestination = {
  INVALID_DESTINATION: {
    status: 422 as const,
    message: "Every destination must be active and belong to this organization" as const,
  },
};

/** A manual run against an orphaned schedule. Every source ref has lost its
 *  backing database: is a 422, not a silent no-op. `missing` lists the dead
 *  refs so the UI can name what broke. */
const scheduleRunErrors = {
  ...scheduleNotFound,
  NO_SOURCES: {
    status: 422 as const,
    message: "This schedule has no live database source to back up" as const,
    data: z.object({ missing: z.array(z.string()) }),
  },
};

const backupRunNotFound = {
  NOT_FOUND: { status: 404 as const, message: "Backup not found" as const },
  INVALID: {
    status: 422 as const,
    message: "Source or destination is not available to this organization" as const,
  },
};

// ─── Restore-proving verification + restore history ─────────────────────

const verificationRowSchema = z.object({
  id: backupVerificationIdField,
  backupId: backupIdField,
  status: z.enum(["queued", "running", "passed", "failed"]),
  trigger: z.enum(["manual", "after-backup"]),
  checks: zJsonObject.nullable(),
  failMessage: z.string().nullable(),
  durationMs: z.number().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
});

const restoreRowSchema = z.object({
  id: backupRestoreIdField,
  backupId: backupIdField,
  mode: z.enum(["download", "in-place"]),
  targetResourceId: resourceIdField.nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  errorMessage: z.string().nullable(),
  durationMs: z.number().nullable(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
});

/** A verification request against a run it can't prove (volume tar, non-pg
 *  engine, never-succeeded run): a 422 naming the reason, not a fake failure. */
const verifyRestoreErrors = {
  ...backupNotFound,
  UNSUPPORTED: {
    status: 422 as const,
    message: "This backup cannot be restore-verified" as const,
    data: z.object({ reason: z.string() }),
  },
};

/** Verify output: an outcome, not an error: an unreachable archive is a
 *  legitimate result the UI must show, so it's encoded in the payload. */
const verifyResultSchema = z.object({
  ok: z.boolean(),
  match: z.boolean().nullable(),
  storedChecksum: z.string().nullable(),
  computedChecksum: z.string().nullable(),
  archiveSizeBytes: z.number().nullable(),
  reason: z.string().nullable(),
});

// ─── Contract ──────────────────────────────────────────────────────────

export const backupsContract = {
  list: oc
    .meta({ path: basePath, tag, method: "GET" })
    .input(listBackupsInput)
    .output(z.array(backupSchema)),

  get: oc
    .errors(backupNotFound)
    .meta({ path: `${basePath}/{id}`, tag, method: "GET" })
    .input(getBackupInput)
    .output(backupSchema),

  // Enqueue + execute a manual "backup now" run for a database resource.
  run: oc
    .errors(backupRunNotFound)
    .meta({ path: `${basePath}/run`, tag, method: "POST" })
    .input(runBackupInput)
    .output(z.object({ ids: z.array(backupIdField), status: z.string() })),

  // Restore a succeeded backup (download bytes as base64, or in-place).
  restore: oc
    .errors(backupNotFound)
    .meta({ path: `${basePath}/{id}/restore`, tag, method: "POST" })
    .input(restoreBackupInput)
    .output(
      z.object({
        ok: z.boolean(),
        mode: z.enum(["download", "in-place"]),
        // base64-encoded archive, present only for `download`.
        data: z.string().nullable(),
        filename: z.string().nullable(),
      }),
    ),

  // Integrity check: re-fetch the stored archive and recompute its checksum.
  verify: oc
    .errors(backupNotFound)
    .meta({ path: `${basePath}/{id}/verify`, tag, method: "POST" })
    .input(getBackupInput)
    .output(verifyResultSchema),

  // Start a restore-proving verification (sandbox restore) detached; poll
  // `verifications` for the outcome.
  verifyRestore: oc
    .errors(verifyRestoreErrors)
    .meta({ path: `${basePath}/{id}/verify-restore`, tag, method: "POST" })
    .input(getBackupInput)
    .output(z.object({ verificationId: backupVerificationIdField, status: z.string() })),

  // Verification history for a run, newest first.
  verifications: oc
    .errors(backupNotFound)
    .meta({ path: `${basePath}/{id}/verifications`, tag, method: "GET" })
    .input(getBackupInput)
    .output(z.array(verificationRowSchema)),

  // Restore history for a run, newest first.
  restores: oc
    .errors(backupNotFound)
    .meta({ path: `${basePath}/{id}/restores`, tag, method: "GET" })
    .input(getBackupInput)
    .output(z.array(restoreRowSchema)),

  // Paginated per-run log lines (cursor = afterSeq).
  logs: oc
    .meta({ path: `${basePath}/{id}/logs`, tag, method: "GET" })
    .input(backupLogsInput)
    .output(z.array(backupLogLineSchema)),

  schedules: {
    list: oc
      .meta({ path: `${basePath}/schedules`, tag, method: "GET" })
      .input(z.object({}).optional())
      .output(z.array(scheduleSchema)),

    create: oc
      .errors(scheduleInvalidDestination)
      .meta({ path: `${basePath}/schedules`, tag, method: "POST" })
      .input(createScheduleInput)
      .output(scheduleSchema),

    update: oc
      .errors({ ...scheduleNotFound, ...scheduleInvalidDestination })
      .meta({ path: `${basePath}/schedules/{id}`, tag, method: "PATCH" })
      .input(updateScheduleInput)
      .output(scheduleSchema),

    delete: oc
      .errors(scheduleNotFound)
      .meta({ path: `${basePath}/schedules/{id}`, tag, method: "DELETE" })
      .input(scheduleIdInput)
      .output(z.object({ ok: z.boolean() })),

    // Trigger a schedule's backups immediately, out-of-band from its cron.
    run: oc
      .errors(scheduleRunErrors)
      .meta({ path: `${basePath}/schedules/{id}/run`, tag, method: "POST" })
      .input(scheduleIdInput)
      .output(z.object({ queued: z.number() })),
  },

  /** Everything backup-able in the org: managed databases AND compose-stack
   *  database services. The picker's list; see `backupSourceSchema`. */
  sources: oc
    .meta({ path: `${basePath}/sources`, tag, method: "GET" })
    .input(z.object({}).optional())
    .output(z.array(backupSourceSchema)),

  destinations: {
    list: oc
      .meta({ path: `${basePath}/destinations`, tag, method: "GET" })
      .input(z.object({}).optional())
      .output(z.array(destinationSchema)),

    create: oc
      .errors(destinationInvalidConfig)
      .meta({ path: `${basePath}/destinations`, tag, method: "POST" })
      .input(createDestinationInput)
      .output(destinationSchema),

    update: oc
      .errors({ ...destinationNotFound, ...destinationInvalidConfig, ...destinationManaged })
      .meta({ path: `${basePath}/destinations/{id}`, tag, method: "PATCH" })
      .input(updateDestinationInput)
      .output(destinationSchema),

    // Operator intent, not health: a disabled destination receives no new
    // backups but keeps its snapshots restorable. Separate from `update` so it
    // works on the managed row, whose config is not editable.
    setEnabled: oc
      .errors({ ...destinationNotFound, ...destinationLastActive })
      .meta({ path: `${basePath}/destinations/{id}/enabled`, tag, method: "PUT" })
      .input(setDestinationEnabledInput)
      .output(destinationSchema),

    delete: oc
      .errors({
        ...destinationNotFound,
        ...destinationManaged,
        CONFLICT: {
          status: 409 as const,
          message: "Destination is in use" as const,
          data: z.object({ references: z.number() }),
        },
      })
      .meta({ path: `${basePath}/destinations/{id}`, tag, method: "DELETE" })
      .input(destinationIdInput)
      .output(z.object({ ok: z.boolean() })),

    test: oc
      .errors({
        ...destinationNotFound,
        TEST_FAILED: {
          status: 422 as const,
          message: "Destination test failed" as const,
          data: z.object({ reason: z.string() }),
        },
      })
      .meta({ path: `${basePath}/destinations/{id}/test`, tag, method: "POST" })
      .input(destinationIdInput)
      .output(testResultSchema),
  },
};
