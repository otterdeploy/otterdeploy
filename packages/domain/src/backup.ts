import { db, eq, and, desc, sql } from "@otterstack/db";
import { backup } from "@otterstack/db/schema/operations";
import { projectResource } from "@otterstack/db/schema/architecture";

import { DomainError } from "./errors";

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function paginationMeta(page: number, pageSize: number, total: number) {
  return {
    pagination: {
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      total,
    },
  };
}

function formatBackup(row: typeof backup.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    resourceId: row.resourceId,
    type: row.type as "manual" | "scheduled",
    status: row.status,
    storageKey: row.storageKey ?? null,
    sizeBytes: row.size ?? null,
    checksum: row.checksum ?? null,
    startedAt: toISOString(row.startedAt),
    completedAt: toISOString(row.completedAt),
    expiresAt: toISOString(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
  };
}

async function validateResource(resourceId: string, organizationId: string) {
  const row = await db.query.projectResource.findFirst({
    where: eq(projectResource.id, resourceId),
    with: {
      environment: { with: { project: true } },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    throw new DomainError("NOT_FOUND", "Resource not found");
  }
  return row;
}

async function validateBackupAccess(backupId: string, organizationId: string) {
  const row = await db.query.backup.findFirst({
    where: and(eq(backup.id, backupId), eq(backup.organizationId, organizationId)),
  });
  if (!row) throw new DomainError("NOT_FOUND", "Backup not found");
  return row;
}

export async function createBackup(params: {
  organizationId: string;
  resourceId: string;
}) {
  await validateResource(params.resourceId, params.organizationId);

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    organizationId: params.organizationId,
    resourceId: params.resourceId,
    type: "manual",
    status: "pending" as const,
    storageKey: null,
    size: null,
    checksum: null,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    errorMessage: null,
    metadata: {},
    createdAt: now,
  };

  await db.insert(backup).values(row);
  return formatBackup(row as typeof backup.$inferSelect);
}

export async function listBackups(params: {
  organizationId: string;
  resourceId?: string;
  page: number;
  pageSize: number;
}) {
  const { page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(backup.organizationId, params.organizationId)];
  if (params.resourceId) conditions.push(eq(backup.resourceId, params.resourceId));

  const whereClause = and(...conditions);

  const [items, [countRow]] = await Promise.all([
    db.query.backup.findMany({
      where: whereClause,
      orderBy: [desc(backup.createdAt)],
      limit: pageSize,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(backup)
      .where(whereClause!),
  ]);

  return {
    items: items.map(formatBackup),
    meta: paginationMeta(page, pageSize, countRow?.count ?? 0),
  };
}

export async function restoreBackup(
  backupId: string,
  targetResourceId: string,
  organizationId: string,
) {
  await validateBackupAccess(backupId, organizationId);
  await validateResource(targetResourceId, organizationId);
  return { success: true as const };
}

export async function deleteBackup(backupId: string, organizationId: string) {
  await validateBackupAccess(backupId, organizationId);
  await db.delete(backup).where(eq(backup.id, backupId));
  return { success: true as const };
}
