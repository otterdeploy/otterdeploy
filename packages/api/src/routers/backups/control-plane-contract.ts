/**
 * Control-plane (whole-install) backup + disaster-recovery contract —
 * od-5j8.13. Nested under `backupsContract.controlPlane`, alongside (but
 * separate from) the org-scoped tenant backup surface: this describes ONE
 * platform-wide singleton (`platform_settings`), not per-org rows, so every
 * endpoint here is install-admin only (see `requireInstallAdmin` in
 * `../../index.ts`) — an organization role never grants authority over it.
 *
 * Execution (pg_dump + tar + encrypt + upload) is a host script
 * (`scripts/control-plane-backup.sh`), not a BullMQ job — see the schema
 * comment on `platformSettings.controlPlaneBackupEnabled`. This contract is
 * the config + status + recovery-key surface around that script, plus the
 * readiness classification (`../../backups/control-plane-readiness.ts`).
 */
import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const tag = "backups";
const basePath = "/backups/control-plane";

const backupDestinationIdField = zId(ID_PREFIX.backupDestination);

const readinessLevel = z.enum(["ready", "degraded", "not_ready"]);

export const controlPlaneReadinessSchema = z.object({
  level: readinessLevel,
  reasons: z.array(z.string()),
  lastBackupAgeHours: z.number().nullable(),
  backupEnabled: z.boolean(),
  destinationConfigured: z.boolean(),
  destinationId: backupDestinationIdField.nullable(),
  destinationName: z.string().nullable(),
  destinationReachable: z.boolean().nullable(),
  recoveryKeyFingerprint: z.string().nullable(),
  recoveryKeyGeneratedAt: z.date().nullable(),
  recoveryKeyExportedAt: z.date().nullable(),
  lastSuccessfulBackupAt: z.date().nullable(),
  lastRunStatus: z.string().nullable(),
  lastRunAt: z.date().nullable(),
  lastRunError: z.string().nullable(),
  lastBackupSizeBytes: z.number().nullable(),
});

const configureInput = z.object({
  destinationId: backupDestinationIdField.nullable(),
  enabled: z.boolean(),
});

/** The raw key is returned ONLY from `generate` — never again. Every other
 *  read of recovery-key state exposes just the fingerprint. */
const recoveryKeyGeneratedSchema = z.object({
  key: z.string(),
  displayKey: z.string(),
  fingerprint: z.string(),
  generatedAt: z.date(),
});

const reportRunInput = z.object({
  status: z.enum(["succeeded", "failed"]),
  sizeBytes: z.number().int().nonnegative().nullable().default(null),
  error: z.string().max(4000).nullable().default(null),
});

const destinationNotFoundError = {
  DESTINATION_NOT_FOUND: {
    status: 404 as const,
    message: "Backup destination not found" as const,
  },
};

export const controlPlaneBackupContract = {
  // Recovery-readiness classification — "could I actually recover right now?"
  readiness: oc
    .meta({ path: basePath, tag, method: "GET" })
    .input(z.object({}).optional())
    .output(controlPlaneReadinessSchema),

  // Assign (or clear) the off-host destination + enable/disable the feature.
  configure: oc
    .errors(destinationNotFoundError)
    .meta({ path: `${basePath}/configure`, tag, method: "POST" })
    .input(configureInput)
    .output(controlPlaneReadinessSchema),

  recoveryKey: {
    // Generates a NEW key, overwriting any previous fingerprint. The caller
    // must display `displayKey` to the operator and tell them to save it
    // off-host immediately — it is never retrievable again.
    generate: oc
      .meta({ path: `${basePath}/recovery-key/generate`, tag, method: "POST" })
      .input(z.object({}).optional())
      .output(recoveryKeyGeneratedSchema),

    // Operator confirms they saved the key shown by `generate`.
    confirmExported: oc
      .meta({ path: `${basePath}/recovery-key/confirm-exported`, tag, method: "POST" })
      .input(z.object({}).optional())
      .output(controlPlaneReadinessSchema),
  },

  // Called by scripts/control-plane-backup.sh after a run completes (success
  // or failure) — the only write path for run-status columns, so the schema
  // stays known in one place instead of being duplicated into shell script.
  reportRun: oc
    .meta({ path: `${basePath}/report-run`, tag, method: "POST" })
    .input(reportRunInput)
    .output(controlPlaneReadinessSchema),
};
