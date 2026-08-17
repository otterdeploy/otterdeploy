/**
 * Row writes + reads for restore-proving verification runs (backup_verification)
 * and the denormalized badge on the run row. Split from verify-restore.ts (the
 * sandbox orchestration) so the engine file stays focused.
 */
import type { BackupId, BackupVerificationId, OrganizationId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

import { db } from "@otterdeploy/db";
import { backup, backupVerification } from "@otterdeploy/db/schema";
import { desc, eq } from "drizzle-orm";

export type VerificationTrigger = "manual" | "after-backup";

export async function createVerificationRun(input: {
  organizationId: OrganizationId;
  backupId: BackupId;
  trigger: VerificationTrigger;
}): Promise<BackupVerificationId> {
  const [row] = await db
    .insert(backupVerification)
    .values({
      organizationId: input.organizationId,
      backupId: input.backupId,
      trigger: input.trigger,
      status: "queued",
    })
    .returning({ id: backupVerification.id });
  if (!row) throw new Error("createVerificationRun: insert returned no rows");
  return row.id;
}

export async function markVerificationRunning(id: BackupVerificationId): Promise<void> {
  await db
    .update(backupVerification)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(backupVerification.id, id));
}

/** Terminal write: verdict + evidence on the verification row, badge on the
 *  run row. One function so the two can never drift apart. */
export async function finishVerification(input: {
  id: BackupVerificationId;
  backupId: BackupId;
  passed: boolean;
  checks: JsonObject | null;
  failMessage: string | null;
  durationMs: number;
}): Promise<void> {
  await db
    .update(backupVerification)
    .set({
      status: input.passed ? "passed" : "failed",
      checks: input.checks,
      failMessage: input.failMessage,
      durationMs: input.durationMs,
      completedAt: new Date(),
    })
    .where(eq(backupVerification.id, input.id));
  await db
    .update(backup)
    .set({ verifiedStatus: input.passed ? "passed" : "failed", verifiedAt: new Date() })
    .where(eq(backup.id, input.backupId));
}

export async function markBackupVerifying(backupId: BackupId): Promise<void> {
  await db.update(backup).set({ verifiedStatus: "running" }).where(eq(backup.id, backupId));
}

export interface VerificationRow {
  id: BackupVerificationId;
  backupId: BackupId;
  status: "queued" | "running" | "passed" | "failed";
  trigger: VerificationTrigger;
  checks: JsonObject | null;
  failMessage: string | null;
  durationMs: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

/** Verification history for one run, newest first (detail drawer + CLI). */
export async function listVerifications(backupId: BackupId): Promise<VerificationRow[]> {
  return db
    .select({
      id: backupVerification.id,
      backupId: backupVerification.backupId,
      status: backupVerification.status,
      trigger: backupVerification.trigger,
      checks: backupVerification.checks,
      failMessage: backupVerification.failMessage,
      durationMs: backupVerification.durationMs,
      startedAt: backupVerification.startedAt,
      completedAt: backupVerification.completedAt,
      createdAt: backupVerification.createdAt,
    })
    .from(backupVerification)
    .where(eq(backupVerification.backupId, backupId))
    .orderBy(desc(backupVerification.createdAt))
    .limit(20);
}
