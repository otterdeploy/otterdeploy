/**
 * Backups oRPC contract — read surface (Phase 2) plus destinations CRUD
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

import { projectIdField, resourceIdField } from "../project/contract/shared";

const tag = "backups";
const basePath = "/backups";

const backupIdField = zId(ID_PREFIX.backup);
const backupScheduleIdField = zId(ID_PREFIX.backupSchedule);
const backupDestinationIdField = zId(ID_PREFIX.backupDestination);

const backupKind = z.enum(["database", "volume", "stack"]);
const destinationType = z.enum(["s3", "local", "sftp"]);

// ─── Output schemas ────────────────────────────────────────────────────

/** One backup run, enriched with joined display fields. */
export const backupSchema = createSelectSchema(backup).extend({
  id: backupIdField,
  resourceId: resourceIdField,
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
});

/** Destination — never exposes `encryptedSecret`; adds computed usage. */
export const destinationSchema = createSelectSchema(backupDestination)
  .omit({ encryptedSecret: true })
  .extend({
    id: backupDestinationIdField,
    config: z.record(z.string(), z.unknown()),
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

// Non-secret connection params (bucket / region / endpoint / prefix / path).
const destinationConfigInput = z.record(z.string(), z.unknown());
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

const testResultSchema = z.object({
  message: z.string(),
});

// ─── Execution + schedule inputs ─────────────────────────────────────────

const runBackupInput = z.object({
  resourceId: resourceIdField,
  // One dump fanned out to every destination — one backup record per id.
  destinationIds: z.array(backupDestinationIdField).min(1),
  encryption: z.enum(["none", "aes-256-gcm"]).default("aes-256-gcm"),
});

const restoreBackupInput = z.object({
  id: backupIdField,
  mode: z.enum(["download", "in-place"]).default("in-place"),
  /** Typed-name confirmation (the resource name). Required for in-place;
   *  enforced server-side so the destructive path can't be called blind. */
  confirm: z.string().optional(),
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
  cron: z.string().min(1),
  destinationIds: z.array(backupDestinationIdField).min(1),
  projectId: projectIdField.optional(),
  // GFS retention tiers — keep the most recent archive per bucket up to N.
  keepDaily: z.number().int().nonnegative().default(0),
  keepWeekly: z.number().int().nonnegative().default(0),
  keepMonthly: z.number().int().nonnegative().default(0),
  keepYearly: z.number().int().nonnegative().default(0),
  retentionDays: z.number().int().positive().nullable().default(null),
  maxStorageGb: z.number().int().positive().nullable().default(null),
  preHook: z.string().max(2000).nullable().default(null),
  encryption: z.enum(["none", "aes-256-gcm"]).default("aes-256-gcm"),
  enabled: z.boolean().default(true),
});

const updateScheduleInput = z.object({
  id: backupScheduleIdField,
  name: z.string().min(1).max(120).optional(),
  sources: z.array(z.string()).optional(),
  cron: z.string().min(1).optional(),
  keepDaily: z.number().int().nonnegative().optional(),
  keepWeekly: z.number().int().nonnegative().optional(),
  keepMonthly: z.number().int().nonnegative().optional(),
  keepYearly: z.number().int().nonnegative().optional(),
  retentionDays: z.number().int().positive().nullable().optional(),
  maxStorageGb: z.number().int().positive().nullable().optional(),
  preHook: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
});

const scheduleIdInput = z.object({ id: backupScheduleIdField });

const scheduleNotFound = {
  NOT_FOUND: { status: 404 as const, message: "Schedule not found" as const },
};

const backupRunNotFound = {
  NOT_FOUND: { status: 404 as const, message: "Backup not found" as const },
  INVALID: {
    status: 422 as const,
    message: "Resource is not a database" as const,
  },
};

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
      .meta({ path: `${basePath}/schedules`, tag, method: "POST" })
      .input(createScheduleInput)
      .output(scheduleSchema),

    update: oc
      .errors(scheduleNotFound)
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
      .errors(scheduleNotFound)
      .meta({ path: `${basePath}/schedules/{id}/run`, tag, method: "POST" })
      .input(scheduleIdInput)
      .output(z.object({ queued: z.number() })),
  },

  destinations: {
    list: oc
      .meta({ path: `${basePath}/destinations`, tag, method: "GET" })
      .input(z.object({}).optional())
      .output(z.array(destinationSchema)),

    create: oc
      .meta({ path: `${basePath}/destinations`, tag, method: "POST" })
      .input(createDestinationInput)
      .output(destinationSchema),

    update: oc
      .errors(destinationNotFound)
      .meta({ path: `${basePath}/destinations/{id}`, tag, method: "PATCH" })
      .input(updateDestinationInput)
      .output(destinationSchema),

    delete: oc
      .errors({
        ...destinationNotFound,
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
