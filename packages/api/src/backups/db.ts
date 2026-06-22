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
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import {
  backup,
  backupDestination,
  backupLog,
  backupSchedule,
  databaseResource,
  project,
  resource,
} from "@otterdeploy/db/schema";

export type DatabaseEngine = "postgres" | "redis" | "mariadb" | "mongodb";

export interface ExecutionContext {
  backupId: BackupId;
  organizationId: OrganizationId;
  resourceId: ResourceId;
  resourceName: string;
  projectId: ProjectId;
  projectSlug: string;
  engine: DatabaseEngine;
  databaseName: string;
  username: string;
  password: string;
  encryption: "none" | "aes-256-gcm" | "kms-managed" | "customer-key";
  /** Pre-backup command (scheduled runs only) — exec'd in the DB container. */
  preHook: string | null;
  destination: {
    id: BackupDestinationId;
    type: "s3" | "local" | "sftp";
    config: Record<string, unknown>;
    encryptedSecret: string | null;
  };
}

/** Everything the engine needs to run + store a backup, in one read. */
export async function getExecutionContext(
  backupId: BackupId,
): Promise<ExecutionContext | null> {
  const [row] = await db
    .select({
      backupId: backup.id,
      organizationId: backup.organizationId,
      resourceId: backup.resourceId,
      encryption: backup.encryption,
      resourceName: resource.name,
      projectId: resource.projectId,
      projectSlug: project.slug,
      engine: databaseResource.engine,
      databaseName: databaseResource.databaseName,
      username: databaseResource.username,
      password: databaseResource.password,
      destId: backupDestination.id,
      destType: backupDestination.type,
      destConfig: backupDestination.config,
      destSecret: backupDestination.encryptedSecret,
      // Pre-hook lives on the schedule; null for manual (scheduleId null) runs.
      preHook: backupSchedule.preHook,
    })
    .from(backup)
    .innerJoin(resource, eq(resource.id, backup.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .innerJoin(
      databaseResource,
      eq(databaseResource.resourceId, backup.resourceId),
    )
    .innerJoin(backupDestination, eq(backupDestination.id, backup.destinationId))
    .leftJoin(backupSchedule, eq(backupSchedule.id, backup.scheduleId))
    .where(eq(backup.id, backupId))
    .limit(1);

  if (!row) return null;
  return {
    backupId: row.backupId,
    organizationId: row.organizationId,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    projectId: row.projectId,
    projectSlug: row.projectSlug,
    engine: row.engine as DatabaseEngine,
    databaseName: row.databaseName,
    username: row.username,
    password: row.password,
    encryption: row.encryption,
    preHook: row.preHook ?? null,
    destination: {
      id: row.destId,
      type: row.destType,
      config: row.destConfig,
      encryptedSecret: row.destSecret,
    },
  };
}

export async function createBackupRun(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  destinationId: BackupDestinationId;
  scheduleId?: BackupScheduleId | null;
  encryption?: "none" | "aes-256-gcm";
  method?: string;
}): Promise<BackupId> {
  const [row] = await db
    .insert(backup)
    .values({
      organizationId: input.organizationId,
      resourceId: input.resourceId,
      destinationId: input.destinationId,
      scheduleId: input.scheduleId ?? null,
      kind: "database",
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
    .where(
      and(
        eq(backupLog.backupId, backupId),
        sql`${backupLog.seq} > ${afterSeq}`,
      ),
    )
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
    checksum: string;
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

export async function markBackupFailed(
  backupId: BackupId,
  errorMessage: string,
): Promise<void> {
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
