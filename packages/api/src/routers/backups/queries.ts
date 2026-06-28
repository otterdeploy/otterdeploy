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

import { db } from "@otterdeploy/db";
import { backup, backupDestination, backupSchedule } from "@otterdeploy/db/schema";
import { databaseResource, project, resource } from "@otterdeploy/db/schema";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";

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
  if (input.destinationId) conditions.push(eq(backup.destinationId, input.destinationId));
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
    .leftJoin(databaseResource, eq(databaseResource.resourceId, backup.resourceId))
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
    .leftJoin(databaseResource, eq(databaseResource.resourceId, backup.resourceId))
    .leftJoin(backupDestination, eq(backupDestination.id, backup.destinationId))
    .where(and(eq(backup.id, input.backupId), eq(backup.organizationId, input.organizationId)))
    .limit(1);
  return row ? toBackupRow(row) : undefined;
}

export interface ScheduleRow {
  schedule: typeof backupSchedule.$inferSelect;
  /** Names for `schedule.destinationIds`, order-preserved, missing ones dropped. */
  destinationNames: string[];
}

export async function listSchedulesByOrg(organizationId: OrganizationId): Promise<ScheduleRow[]> {
  // `destinationIds` is a jsonb array, not an FK, so resolve names via a small
  // org-wide destination lookup rather than a join.
  const [schedules, dests] = await Promise.all([
    db
      .select()
      .from(backupSchedule)
      .where(eq(backupSchedule.organizationId, organizationId))
      .orderBy(asc(backupSchedule.createdAt)),
    db
      .select({ id: backupDestination.id, name: backupDestination.name })
      .from(backupDestination)
      .where(eq(backupDestination.organizationId, organizationId)),
  ]);

  const nameById = new Map(dests.map((d) => [d.id, d.name]));
  return schedules.map((schedule) => ({
    schedule,
    destinationNames: schedule.destinationIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => Boolean(n)),
  }));
}

// Backup-destination queries live in a sibling module; re-exported here so the
// router's `./queries` import surface stays a single entry point.
export {
  countDestinationReferences,
  createDestinationRecord,
  deleteDestinationRecord,
  getDestinationWithSecret,
  listDestinationsByOrg,
  resolveDestinationNames,
  updateDestinationRecord,
  type DestinationRow,
  type DestinationView,
} from "./destination-queries";
