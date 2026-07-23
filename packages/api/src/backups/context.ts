/**
 * Execution-context read for the backup engine: one query that assembles
 * everything a run needs (source + destination + credentials) into the
 * discriminated `ExecutionContext` the engine consumes. Split from `db.ts` (the
 * run/log write surface) so each stays under the line cap and the engine's read
 * shape lives in one place.
 */
import type {
  BackupDestinationId,
  BackupId,
  BackupScheduleId,
  OrganizationId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  backup,
  backupDestination,
  backupSchedule,
  databaseResource,
  project,
  resource,
} from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";

import { resolveStackDumpTarget } from "./stack";

export type DatabaseEngine = "postgres" | "redis" | "mariadb" | "mongodb";

/** Fields common to every run, regardless of what it backs up. */
interface ExecutionContextBase {
  backupId: BackupId;
  organizationId: OrganizationId;
  encryption: "none" | "aes-256-gcm" | "kms-managed" | "customer-key";
  /** Where the produced archive landed (null until the run succeeds). */
  storagePath: string | null;
  /** sha256 of the stored archive body (null until the run succeeds). */
  checksum: string | null;
  /** Pre-backup command (scheduled runs only) — exec'd in the DB container. */
  preHook: string | null;
  /** Owning schedule (null for manual runs); tags snapshots for tag-scoped `forget`. */
  scheduleId: BackupScheduleId | null;
  destination: {
    id: BackupDestinationId;
    type: "s3" | "local" | "sftp";
    config: Record<string, unknown>;
    encryptedSecret: string | null;
  };
}

/** Discriminated by source: a managed-database dump, a compose-stack database
 *  dump, or a named-volume tar. `database` and `stack` carry an identical field
 *  set (engine + credentials + the container's resourceId) — they differ only in
 *  provenance, so the whole dump→rustic pipeline treats them uniformly. */
export type ExecutionContext =
  | (ExecutionContextBase & {
      kind: "database" | "stack";
      resourceId: ResourceId;
      resourceName: string;
      projectId: ProjectId;
      projectSlug: string;
      engine: DatabaseEngine;
      databaseName: string;
      username: string;
      password: string;
    })
  | (ExecutionContextBase & {
      kind: "volume";
      volumeName: string;
    });

interface ContextRow {
  backupId: BackupId;
  organizationId: OrganizationId;
  kind: "database" | "volume" | "stack";
  resourceId: ResourceId | null;
  volumeName: string | null;
  encryption: ExecutionContextBase["encryption"];
  storagePath: string | null;
  checksum: string | null;
  resourceName: string | null;
  projectId: ProjectId | null;
  projectSlug: string | null;
  engine: string | null;
  databaseName: string | null;
  username: string | null;
  password: string | null;
  destId: BackupDestinationId;
  destType: "s3" | "local" | "sftp";
  destConfig: Record<string, unknown>;
  destSecret: string | null;
  preHook: string | null;
  scheduleId: BackupScheduleId | null;
}

function toBase(row: ContextRow): ExecutionContextBase {
  return {
    backupId: row.backupId,
    organizationId: row.organizationId,
    encryption: row.encryption,
    storagePath: row.storagePath,
    checksum: row.checksum,
    preHook: row.preHook ?? null,
    scheduleId: row.scheduleId,
    destination: {
      id: row.destId,
      type: row.destType,
      config: row.destConfig,
      encryptedSecret: row.destSecret,
    },
  };
}

/** Compose-stack database: no `database_resource` row, so derive engine +
 *  credentials from the materialized service (image + env bag). Null when it
 *  isn't a resolvable stack DB. */
async function toStackContext(
  base: ExecutionContextBase,
  resourceId: ResourceId,
): Promise<ExecutionContext | null> {
  const target = await resolveStackDumpTarget(resourceId);
  if (!target) return null;
  return {
    ...base,
    kind: "stack",
    resourceId,
    resourceName: target.resourceName,
    projectId: target.projectId,
    projectSlug: target.projectSlug,
    engine: target.engine,
    databaseName: target.databaseName,
    username: target.username,
    password: target.password,
  };
}

/** Managed database — require the full resource + database join to have
 *  resolved, same as the old inner joins. */
function toDatabaseContext(base: ExecutionContextBase, row: ContextRow): ExecutionContext | null {
  if (
    !row.resourceId ||
    !row.resourceName ||
    !row.projectId ||
    !row.projectSlug ||
    !row.engine ||
    row.databaseName == null ||
    row.username == null ||
    row.password == null
  ) {
    return null;
  }
  return {
    ...base,
    kind: "database",
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    projectId: row.projectId,
    projectSlug: row.projectSlug,
    engine: row.engine as DatabaseEngine,
    databaseName: row.databaseName,
    username: row.username,
    password: row.password,
  };
}

/** Everything the engine needs to run + store a backup, in one read. Left-joins
 *  the resource/database rows because volume runs have no resource at all. */
export async function getExecutionContext(backupId: BackupId): Promise<ExecutionContext | null> {
  const [row] = await db
    .select({
      backupId: backup.id,
      organizationId: backup.organizationId,
      kind: backup.kind,
      resourceId: backup.resourceId,
      volumeName: backup.volumeName,
      encryption: backup.encryption,
      storagePath: backup.storagePath,
      checksum: backup.checksum,
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
      scheduleId: backup.scheduleId,
    })
    .from(backup)
    .leftJoin(resource, eq(resource.id, backup.resourceId))
    .leftJoin(project, eq(project.id, resource.projectId))
    .leftJoin(databaseResource, eq(databaseResource.resourceId, backup.resourceId))
    .innerJoin(backupDestination, eq(backupDestination.id, backup.destinationId))
    .leftJoin(backupSchedule, eq(backupSchedule.id, backup.scheduleId))
    .where(eq(backup.id, backupId))
    .limit(1);

  if (!row) return null;
  const base = toBase(row);

  if (row.kind === "volume") {
    return row.volumeName ? { ...base, kind: "volume", volumeName: row.volumeName } : null;
  }
  if (row.kind === "stack") {
    return row.resourceId ? toStackContext(base, row.resourceId) : null;
  }
  return toDatabaseContext(base, row);
}
