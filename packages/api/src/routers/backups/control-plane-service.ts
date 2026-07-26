/**
 * Whole-control-plane backup config/status/readiness — the platform-wide
 * singleton half of od-5j8.13 (see control-plane-contract.ts for why this is
 * install-admin only and not org-scoped, and
 * ../../backups/control-plane-readiness.ts for the pure classification this
 * assembles real signals for).
 *
 * Destination reuse: `controlPlaneBackupDestinationId` points at an existing
 * (org-scoped) `backup_destination` row — deliberately not a second
 * destination-config surface. `destinationReachable` below is the SAME
 * structural check `destinations.test` already performs (required config
 * present + stored credential decrypts) — it is NOT a live network probe.
 * See the doc comment on `testDestination` in destination-service.ts; this
 * module calls the same primitives rather than duplicating the check.
 */
import type { BackupDestinationId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupDestination } from "@otterdeploy/db/schema/backup";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { and, eq } from "drizzle-orm";

import { classifyControlPlaneReadiness } from "../../backups/control-plane-readiness";
import { decryptSecret } from "../../lib/crypto";
import {
  formatRecoveryKeyForDisplay,
  generateRecoveryKey,
  recoveryKeyFingerprint,
} from "../../lib/recovery-key";
import { missingConfigKeys } from "./destination-config";

type PlatformRow = typeof platformSettings.$inferSelect;
type PlatformPatch = Partial<typeof platformSettings.$inferInsert>;

export interface ReadinessView {
  level: "ready" | "degraded" | "not_ready";
  reasons: string[];
  lastBackupAgeHours: number | null;
  backupEnabled: boolean;
  destinationConfigured: boolean;
  destinationId: BackupDestinationId | null;
  destinationName: string | null;
  destinationReachable: boolean | null;
  recoveryKeyFingerprint: string | null;
  recoveryKeyGeneratedAt: Date | null;
  recoveryKeyExportedAt: Date | null;
  lastSuccessfulBackupAt: Date | null;
  lastRunStatus: string | null;
  lastRunAt: Date | null;
  lastRunError: string | null;
  lastBackupSizeBytes: number | null;
}

async function readRow(): Promise<PlatformRow | undefined> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row;
}

async function upsert(patch: PlatformPatch): Promise<PlatformRow> {
  const [row] = await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...patch })
    .onConflictDoUpdate({ target: platformSettings.id, set: patch })
    .returning();
  if (!row) throw new Error("control-plane-service: upsert returned no row");
  return row;
}

/** Structural-only check (config present + secret decrypts) — see the module
 *  doc comment. `null` = no destination configured, so there's nothing to
 *  check yet (the readiness classifier treats that as its own signal). */
async function probeDestination(
  destinationId: BackupDestinationId | null,
): Promise<{ name: string | null; reachable: boolean | null }> {
  if (!destinationId) return { name: null, reachable: null };
  const [row] = await db
    .select({
      name: backupDestination.name,
      type: backupDestination.type,
      config: backupDestination.config,
      encryptedSecret: backupDestination.encryptedSecret,
    })
    .from(backupDestination)
    .where(eq(backupDestination.id, destinationId))
    .limit(1);
  if (!row) return { name: null, reachable: false };

  const missing = missingConfigKeys(row.type, row.config);
  if (missing.length > 0) return { name: row.name, reachable: false };

  if (row.type !== "local") {
    if (!row.encryptedSecret) return { name: row.name, reachable: false };
    try {
      await decryptSecret(row.encryptedSecret);
    } catch {
      return { name: row.name, reachable: false };
    }
  }
  return { name: row.name, reachable: true };
}

/** The all-columns-absent shape — same defaults the DB columns themselves use
 *  (see the schema: `controlPlaneBackupEnabled` is `.default(false)`,
 *  everything else is a nullable timestamp/text). Used ONLY when no
 *  `platform_settings` row exists yet at all (pre-bootstrap), so
 *  `withDefaults` needs a single `row ?? DEFAULT_ROW` instead of a `??` per
 *  field — the repeated per-field fallback is what pushed this function over
 *  the linter's complexity ceiling. */
const DEFAULT_ROW: Pick<
  PlatformRow,
  | "controlPlaneBackupDestinationId"
  | "controlPlaneBackupEnabled"
  | "controlPlaneRecoveryKeyFingerprint"
  | "controlPlaneRecoveryKeyGeneratedAt"
  | "controlPlaneRecoveryKeyExportedAt"
  | "controlPlaneLastBackupAt"
  | "controlPlaneLastRunStatus"
  | "controlPlaneLastRunAt"
  | "controlPlaneLastRunError"
  | "controlPlaneLastBackupSizeBytes"
> = {
  controlPlaneBackupDestinationId: null,
  controlPlaneBackupEnabled: false,
  controlPlaneRecoveryKeyFingerprint: null,
  controlPlaneRecoveryKeyGeneratedAt: null,
  controlPlaneRecoveryKeyExportedAt: null,
  controlPlaneLastBackupAt: null,
  controlPlaneLastRunStatus: null,
  controlPlaneLastRunAt: null,
  controlPlaneLastRunError: null,
  controlPlaneLastBackupSizeBytes: null,
};

function withDefaults(row: PlatformRow | undefined) {
  const effective = row ?? DEFAULT_ROW;
  return {
    destinationId: effective.controlPlaneBackupDestinationId as BackupDestinationId | null,
    backupEnabled: effective.controlPlaneBackupEnabled,
    recoveryKeyFingerprint: effective.controlPlaneRecoveryKeyFingerprint,
    recoveryKeyGeneratedAt: effective.controlPlaneRecoveryKeyGeneratedAt,
    recoveryKeyExportedAt: effective.controlPlaneRecoveryKeyExportedAt,
    lastSuccessfulBackupAt: effective.controlPlaneLastBackupAt,
    lastRunStatus: effective.controlPlaneLastRunStatus as "succeeded" | "failed" | null,
    lastRunAt: effective.controlPlaneLastRunAt,
    lastRunError: effective.controlPlaneLastRunError,
    lastBackupSizeBytes: effective.controlPlaneLastBackupSizeBytes,
  };
}

async function buildReadinessView(row: PlatformRow | undefined): Promise<ReadinessView> {
  const defaults = withDefaults(row);
  const { name, reachable } = await probeDestination(defaults.destinationId);
  const destinationConfigured = defaults.destinationId !== null;

  const classified = classifyControlPlaneReadiness({
    now: new Date(),
    backupEnabled: defaults.backupEnabled,
    destinationConfigured,
    destinationReachable: reachable,
    recoveryKeyExportedAt: defaults.recoveryKeyExportedAt,
    lastSuccessfulBackupAt: defaults.lastSuccessfulBackupAt,
    mostRecentRunStatus: defaults.lastRunStatus,
    mostRecentRunAt: defaults.lastRunAt,
  });

  return {
    ...classified,
    ...defaults,
    destinationConfigured,
    destinationName: name,
    destinationReachable: reachable,
  };
}

export async function getControlPlaneReadiness(): Promise<ReadinessView> {
  return buildReadinessView(await readRow());
}

/** Assign/clear the destination and flip the enabled switch. `organizationId`
 *  scopes which destinations may be selected — an install admin may only
 *  point control-plane backups at a destination owned by their OWN active
 *  org (mirrors the same restraint `autoConfigureControlPlaneDomain` applies
 *  to Cloudflare credentials: install-admin status doesn't imply "read any
 *  org's resources on request"). */
export async function configureControlPlaneBackup(input: {
  organizationId: OrganizationId;
  destinationId: BackupDestinationId | null;
  enabled: boolean;
}): Promise<ReadinessView | { notFound: true }> {
  if (input.destinationId) {
    const [owned] = await db
      .select({ id: backupDestination.id })
      .from(backupDestination)
      .where(
        and(
          eq(backupDestination.id, input.destinationId),
          eq(backupDestination.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!owned) return { notFound: true };
  }
  const row = await upsert({
    controlPlaneBackupDestinationId: input.destinationId,
    controlPlaneBackupEnabled: input.enabled,
  });
  return buildReadinessView(row);
}

/** Generate a brand-new recovery key. Returns the RAW key exactly once — the
 *  caller (router) must hand it straight back to the operator and never log
 *  or persist it; only the fingerprint is stored. Overwrites any previous
 *  fingerprint, which means a previously-generated (and possibly still-held)
 *  key stops being verifiable via the UI fingerprint check — but any archive
 *  already encrypted with it remains decryptable by that old key forever
 *  (the archive doesn't reference the platform's fingerprint at decrypt
 *  time, only its own embedded one — see wrapControlPlaneArchive). */
export async function generateControlPlaneRecoveryKey(): Promise<{
  key: string;
  displayKey: string;
  fingerprint: string;
  generatedAt: Date;
}> {
  const key = generateRecoveryKey();
  const fingerprint = await recoveryKeyFingerprint(key);
  const generatedAt = new Date();
  await upsert({
    controlPlaneRecoveryKeyFingerprint: fingerprint,
    controlPlaneRecoveryKeyGeneratedAt: generatedAt,
    // A freshly generated key has NOT been exported yet — force the operator
    // through an explicit confirmation before readiness can call it done.
    controlPlaneRecoveryKeyExportedAt: null,
  });
  return { key, displayKey: formatRecoveryKeyForDisplay(key), fingerprint, generatedAt };
}

export async function confirmControlPlaneRecoveryKeyExported(): Promise<ReadinessView> {
  const row = await upsert({ controlPlaneRecoveryKeyExportedAt: new Date() });
  return buildReadinessView(row);
}

export async function reportControlPlaneBackupRun(input: {
  status: "succeeded" | "failed";
  sizeBytes: number | null;
  error: string | null;
}): Promise<ReadinessView> {
  const now = new Date();
  const patch: PlatformPatch = {
    controlPlaneLastRunStatus: input.status,
    controlPlaneLastRunAt: now,
    controlPlaneLastRunError: input.status === "failed" ? input.error : null,
  };
  if (input.status === "succeeded") {
    patch.controlPlaneLastBackupAt = now;
    patch.controlPlaneLastBackupSizeBytes = input.sizeBytes;
  }
  const row = await upsert(patch);
  return buildReadinessView(row);
}
