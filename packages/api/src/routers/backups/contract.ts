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
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { backup, backupDestination, backupSchedule } from "@otterdeploy/db/schema";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

import { projectIdField, resourceIdField } from "../project/contract/shared";

const tag = "backups";
const basePath = "/backups";

export const backupIdField = zId(ID_PREFIX.backup);
export const backupScheduleIdField = zId(ID_PREFIX.backupSchedule);
export const backupDestinationIdField = zId(ID_PREFIX.backupDestination);

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
  destinationId: backupDestinationIdField,
  // drizzle-zod can't recover the `.$type<string[]>()` off a jsonb column;
  // restate it explicitly so the output type is `string[]`, not `$strip[]`.
  sources: z.array(z.string()),
  destinationName: z.string().nullable(),
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

export const listBackupsInput = z
  .object({
    projectId: projectIdField.optional(),
    kind: backupKind.optional(),
    destinationId: backupDestinationIdField.optional(),
    search: z.string().optional(),
  })
  .optional();

export const getBackupInput = z.object({ id: backupIdField });

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

export const createDestinationInput = z.object({
  name: z.string().min(1).max(120),
  type: destinationType,
  config: destinationConfigInput.default({}),
  secret: destinationSecretInput.optional(),
});

export const updateDestinationInput = z.object({
  id: backupDestinationIdField,
  name: z.string().min(1).max(120).optional(),
  config: destinationConfigInput.optional(),
  // Omit / empty to leave the stored secret in place.
  secret: destinationSecretInput.optional(),
});

export const destinationIdInput = z.object({ id: backupDestinationIdField });

export const testResultSchema = z.object({
  message: z.string(),
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

  schedules: {
    list: oc
      .meta({ path: `${basePath}/schedules`, tag, method: "GET" })
      .input(z.object({}).optional())
      .output(z.array(scheduleSchema)),
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
