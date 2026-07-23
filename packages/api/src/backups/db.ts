/**
 * Execution-plane queries for the backup engine: create runs, stream logs,
 * transition run status, and drive the schedule scanner + retention. Kept
 * separate from the router's read-side `queries.ts` so the engine owns its
 * write surface.
 */
import type {
  BackupDestinationId,
  BackupId,
  BackupScheduleId,
  OrganizationId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backup, backupLog, databaseResource, project, resource } from "@otterdeploy/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";

// The execution-context read (source + destination + credentials → engine ctx)
// lives in ./context; re-exported here so the engine's existing `./db` imports
// are unchanged.
export type { DatabaseEngine, ExecutionContext } from "./context";
export { getExecutionContext } from "./context";

/** Source of a new run. `database` (managed) and `stack` (compose-service DB)
 *  both key off a resourceId; `volume` off a volume name. */
export type BackupRunSource =
  | { kind: "database"; resourceId: ResourceId }
  | { kind: "stack"; resourceId: ResourceId }
  | { kind: "volume"; volumeName: string };

export async function createBackupRun(input: {
  organizationId: OrganizationId;
  source: BackupRunSource;
  destinationId: BackupDestinationId;
  scheduleId?: BackupScheduleId | null;
  encryption?: "none" | "aes-256-gcm";
  method?: string;
}): Promise<BackupId> {
  const [row] = await db
    .insert(backup)
    .values({
      organizationId: input.organizationId,
      resourceId: input.source.kind === "volume" ? null : input.source.resourceId,
      volumeName: input.source.kind === "volume" ? input.source.volumeName : null,
      destinationId: input.destinationId,
      scheduleId: input.scheduleId ?? null,
      kind: input.source.kind,
      status: "queued",
      encryption: input.encryption ?? "aes-256-gcm",
      method: input.method,
    })
    .returning({ id: backup.id });
  if (!row) throw new Error("createBackupRun: insert returned no rows");
  return row.id;
}

export async function appendBackupLog(
  backupId: BackupId,
  stream: "stdout" | "stderr" | "system",
  line: string,
): Promise<void> {
  await db.insert(backupLog).values({ backupId, stream, line });
}

export async function listBackupLogs(
  backupId: BackupId,
  afterSeq = 0,
): Promise<Array<{ seq: number; stream: string; line: string; ts: Date }>> {
  return db
    .select({
      seq: backupLog.seq,
      stream: backupLog.stream,
      line: backupLog.line,
      ts: backupLog.ts,
    })
    .from(backupLog)
    .where(and(eq(backupLog.backupId, backupId), sql`${backupLog.seq} > ${afterSeq}`))
    .orderBy(asc(backupLog.seq))
    .limit(1000);
}

export async function markBackupRunning(backupId: BackupId): Promise<void> {
  await db
    .update(backup)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(backup.id, backupId));
}

export async function markBackupSucceeded(
  backupId: BackupId,
  fields: {
    storagePath: string;
    /** rustic owns integrity via `check`; null for rustic-engine runs. */
    checksum: string | null;
    compressedSizeBytes: number;
    sourceSizeBytes?: number;
    durationMs: number;
    method: string;
  },
): Promise<void> {
  await db
    .update(backup)
    .set({
      status: "succeeded",
      completedAt: new Date(),
      storagePath: fields.storagePath,
      checksum: fields.checksum,
      compressedSizeBytes: fields.compressedSizeBytes,
      sourceSizeBytes: fields.sourceSizeBytes,
      durationMs: fields.durationMs,
      method: fields.method,
    })
    .where(eq(backup.id, backupId));
}

export async function markBackupFailed(backupId: BackupId, errorMessage: string): Promise<void> {
  await db
    .update(backup)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: errorMessage.slice(0, 4000),
    })
    .where(eq(backup.id, backupId));
}

/** Validate a resource is a database in the given org (for manual run). */
export async function getDatabaseResourceInOrg(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
}): Promise<{ resourceId: ResourceId } | null> {
  const [row] = await db
    .select({ resourceId: databaseResource.resourceId })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(databaseResource.resourceId, input.resourceId),
        eq(project.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}
