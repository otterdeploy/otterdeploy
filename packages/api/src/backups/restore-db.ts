/**
 * Persisted restore runs (backup_restore): every restore attempt gets a row -
 * status, target, duration, failure: so restores have history and observable
 * state instead of living only inside a blocking RPC. Written by restore.ts.
 */
import type { BackupId, BackupRestoreId, OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupRestore } from "@otterdeploy/db/schema";
import { and, desc, eq } from "drizzle-orm";

export async function createRestoreRun(input: {
  organizationId: OrganizationId;
  backupId: BackupId;
  mode: "download" | "in-place";
  targetResourceId: ResourceId | null;
}): Promise<BackupRestoreId> {
  const [row] = await db
    .insert(backupRestore)
    .values({
      organizationId: input.organizationId,
      backupId: input.backupId,
      mode: input.mode,
      targetResourceId: input.targetResourceId,
      status: "running",
    })
    .returning({ id: backupRestore.id });
  if (!row) throw new Error("createRestoreRun: insert returned no rows");
  return row.id;
}

/** running → succeeded/failed. Guarded: a restore the boot reconcile already
 *  failed (the process restarted mid-restore) keeps that outcome. Returns
 *  whether this call settled the row. */
export async function finishRestoreRun(input: {
  id: BackupRestoreId;
  status: "succeeded" | "failed";
  errorMessage?: string | null;
  durationMs: number;
}): Promise<boolean> {
  const rows = await db
    .update(backupRestore)
    .set({
      status: input.status,
      errorMessage: input.errorMessage?.slice(0, 4000) ?? null,
      durationMs: input.durationMs,
      completedAt: new Date(),
    })
    .where(and(eq(backupRestore.id, input.id), eq(backupRestore.status, "running")))
    .returning({ id: backupRestore.id });
  return rows.length > 0;
}

export interface RestoreRow {
  id: BackupRestoreId;
  backupId: BackupId;
  mode: "download" | "in-place";
  targetResourceId: ResourceId | null;
  status: "running" | "succeeded" | "failed";
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: Date;
  completedAt: Date | null;
}

/** Restore history for one run, newest first (detail drawer + CLI). */
export async function listRestores(backupId: BackupId): Promise<RestoreRow[]> {
  return db
    .select({
      id: backupRestore.id,
      backupId: backupRestore.backupId,
      mode: backupRestore.mode,
      targetResourceId: backupRestore.targetResourceId,
      status: backupRestore.status,
      errorMessage: backupRestore.errorMessage,
      durationMs: backupRestore.durationMs,
      startedAt: backupRestore.startedAt,
      completedAt: backupRestore.completedAt,
    })
    .from(backupRestore)
    .where(eq(backupRestore.backupId, backupId))
    .orderBy(desc(backupRestore.startedAt))
    .limit(20);
}
