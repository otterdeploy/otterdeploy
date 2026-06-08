/**
 * Org-scoped DB queries for the backups router. Reads join in the few display
 * fields the UI can't derive (resource + project names, db host, destination
 * name) and never select `encryptedSecret`.
 */
import type {
  BackupDestinationId,
  BackupId,
  OrganizationId,
  ProjectId,
} from "@otterdeploy/shared/id";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import {
  backup,
  backupDestination,
  backupSchedule,
} from "@otterdeploy/db/schema";
import { databaseResource, project, resource } from "@otterdeploy/db/schema";

type BackupKind = "database" | "volume" | "stack";

export interface BackupRow {
  backup: typeof backup.$inferSelect;
  source: string | null;
  project: string | null;
  sourceService: string | null;
  sourceHost: string | null;
  destinationName: string | null;
  destinationType: "s3" | "local" | "sftp" | null;
}

const backupSelection = {
  backup,
  resourceName: resource.name,
  projectSlug: project.slug,
  dbHost: databaseResource.internalHostname,
  dbPort: databaseResource.internalPort,
  destName: backupDestination.name,
  destType: backupDestination.type,
};

function toBackupRow(r: {
  backup: typeof backup.$inferSelect;
  resourceName: string | null;
  projectSlug: string | null;
  dbHost: string | null;
  dbPort: number | null;
  destName: string | null;
  destType: "s3" | "local" | "sftp" | null;
}): BackupRow {
  return {
    backup: r.backup,
    source: r.resourceName,
    project: r.projectSlug,
    sourceService: r.resourceName,
    sourceHost: r.dbHost ? `${r.dbHost}:${r.dbPort ?? ""}` : null,
    destinationName: r.destName,
    destinationType: r.destType,
  };
}

export async function listBackupsByOrg(input: {
  organizationId: OrganizationId;
  projectId?: ProjectId;
  kind?: BackupKind;
  destinationId?: BackupDestinationId;
  search?: string;
}): Promise<BackupRow[]> {
  const conditions = [eq(backup.organizationId, input.organizationId)];
  if (input.projectId) conditions.push(eq(resource.projectId, input.projectId));
  if (input.kind) conditions.push(eq(backup.kind, input.kind));
  if (input.destinationId)
    conditions.push(eq(backup.destinationId, input.destinationId));
  if (input.search) {
    const q = `%${input.search}%`;
    const match = or(
      ilike(resource.name, q),
      ilike(backup.id, q),
      ilike(databaseResource.internalHostname, q),
    );
    if (match) conditions.push(match);
  }

  const rows = await db
    .select(backupSelection)
    .from(backup)
    .innerJoin(resource, eq(resource.id, backup.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .leftJoin(
      databaseResource,
      eq(databaseResource.resourceId, backup.resourceId),
    )
    .leftJoin(backupDestination, eq(backupDestination.id, backup.destinationId))
    .where(and(...conditions))
    .orderBy(desc(backup.createdAt));

  return rows.map(toBackupRow);
}

export async function getBackupInOrg(input: {
  backupId: BackupId;
  organizationId: OrganizationId;
}): Promise<BackupRow | undefined> {
  const [row] = await db
    .select(backupSelection)
    .from(backup)
    .innerJoin(resource, eq(resource.id, backup.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .leftJoin(
      databaseResource,
      eq(databaseResource.resourceId, backup.resourceId),
    )
    .leftJoin(backupDestination, eq(backupDestination.id, backup.destinationId))
    .where(
      and(
        eq(backup.id, input.backupId),
        eq(backup.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ? toBackupRow(row) : undefined;
}

export interface ScheduleRow {
  schedule: typeof backupSchedule.$inferSelect;
  destinationName: string | null;
}

export async function listSchedulesByOrg(
  organizationId: OrganizationId,
): Promise<ScheduleRow[]> {
  const rows = await db
    .select({ schedule: backupSchedule, destName: backupDestination.name })
    .from(backupSchedule)
    .leftJoin(
      backupDestination,
      eq(backupDestination.id, backupSchedule.destinationId),
    )
    .where(eq(backupSchedule.organizationId, organizationId))
    .orderBy(asc(backupSchedule.createdAt));

  return rows.map((r) => ({
    schedule: r.schedule,
    destinationName: r.destName,
  }));
}

export interface DestinationRow {
  destination: Omit<typeof backupDestination.$inferSelect, "encryptedSecret">;
  usedBytes: number;
}

// Safe view — never selects `encryptedSecret`.
const DESTINATION_VIEW = {
  id: backupDestination.id,
  organizationId: backupDestination.organizationId,
  name: backupDestination.name,
  type: backupDestination.type,
  config: backupDestination.config,
  status: backupDestination.status,
  createdAt: backupDestination.createdAt,
  updatedAt: backupDestination.updatedAt,
} as const;

export type DestinationView = Omit<
  typeof backupDestination.$inferSelect,
  "encryptedSecret"
>;

export async function getDestinationForOrg(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
}): Promise<DestinationView | null> {
  const [row] = await db
    .select(DESTINATION_VIEW)
    .from(backupDestination)
    .where(
      and(
        eq(backupDestination.id, input.id),
        eq(backupDestination.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Includes the encrypted secret + config — for the `test`/engine decrypt path only. */
export async function getDestinationWithSecret(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
}): Promise<
  | {
      type: "s3" | "local" | "sftp";
      config: Record<string, unknown>;
      encryptedSecret: string | null;
    }
  | null
> {
  const [row] = await db
    .select({
      type: backupDestination.type,
      config: backupDestination.config,
      encryptedSecret: backupDestination.encryptedSecret,
    })
    .from(backupDestination)
    .where(
      and(
        eq(backupDestination.id, input.id),
        eq(backupDestination.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createDestinationRecord(input: {
  organizationId: OrganizationId;
  name: string;
  type: "s3" | "local" | "sftp";
  config: Record<string, unknown>;
  encryptedSecret: string | null;
}): Promise<DestinationView> {
  const [row] = await db
    .insert(backupDestination)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      type: input.type,
      config: input.config,
      encryptedSecret: input.encryptedSecret,
    })
    .returning(DESTINATION_VIEW);
  if (!row) throw new Error("createDestinationRecord: insert returned no rows");
  return row;
}

export async function updateDestinationRecord(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
  name?: string;
  config?: Record<string, unknown>;
  encryptedSecret?: string;
}): Promise<DestinationView | null> {
  const patch: Partial<typeof backupDestination.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.config !== undefined) patch.config = input.config;
  if (input.encryptedSecret !== undefined)
    patch.encryptedSecret = input.encryptedSecret;

  if (Object.keys(patch).length === 0) {
    return getDestinationForOrg({
      organizationId: input.organizationId,
      id: input.id,
    });
  }

  const [row] = await db
    .update(backupDestination)
    .set(patch)
    .where(
      and(
        eq(backupDestination.id, input.id),
        eq(backupDestination.organizationId, input.organizationId),
      ),
    )
    .returning(DESTINATION_VIEW);
  return row ?? null;
}

/** Count schedules + backups still pointing at a destination (delete guard). */
export async function countDestinationReferences(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
}): Promise<number> {
  const [sched] = await db
    .select({ n: sql<string>`count(*)` })
    .from(backupSchedule)
    .where(eq(backupSchedule.destinationId, input.id));
  const [bak] = await db
    .select({ n: sql<string>`count(*)` })
    .from(backup)
    .where(eq(backup.destinationId, input.id));
  return Number(sched?.n ?? 0) + Number(bak?.n ?? 0);
}

export async function deleteDestinationRecord(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
}): Promise<{ id: BackupDestinationId } | null> {
  const [row] = await db
    .delete(backupDestination)
    .where(
      and(
        eq(backupDestination.id, input.id),
        eq(backupDestination.organizationId, input.organizationId),
      ),
    )
    .returning({ id: backupDestination.id });
  return row ?? null;
}

export async function listDestinationsByOrg(
  organizationId: OrganizationId,
): Promise<DestinationRow[]> {
  const rows = await db
    .select({
      id: backupDestination.id,
      organizationId: backupDestination.organizationId,
      name: backupDestination.name,
      type: backupDestination.type,
      config: backupDestination.config,
      status: backupDestination.status,
      createdAt: backupDestination.createdAt,
      updatedAt: backupDestination.updatedAt,
      // bigint sum comes back as a string in pg; coerce in JS below.
      usedBytes: sql<string>`coalesce(sum(${backup.compressedSizeBytes}), 0)`,
    })
    .from(backupDestination)
    .leftJoin(backup, eq(backup.destinationId, backupDestination.id))
    .where(eq(backupDestination.organizationId, organizationId))
    .groupBy(backupDestination.id)
    .orderBy(asc(backupDestination.createdAt));

  return rows.map(({ usedBytes, ...destination }) => ({
    destination,
    usedBytes: Number(usedBytes) || 0,
  }));
}
