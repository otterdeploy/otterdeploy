import { Result } from "better-result";
import { db, eq, and, desc, sql } from "@otterdeploy/db";
import { backup } from "@otterdeploy/db/schema/operations";
import { resource } from "@otterdeploy/db/schema/project";

import { createId } from "@otterdeploy/utils";

import { NotFoundError, ConflictError } from "./errors";

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

async function validateResource(
  resourceId: string,
  organizationId: string,
): Promise<Result<typeof resource.$inferSelect, NotFoundError>> {
  const row = await db.query.resource.findFirst({
    where: eq(resource.id, resourceId),
    with: {
      environment: { with: { project: true } },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    return Result.err(new NotFoundError({ resource: "resource", id: resourceId }));
  }
  return Result.ok(row);
}

async function validateBackupAccess(
  backupId: string,
  organizationId: string,
): Promise<Result<typeof backup.$inferSelect, NotFoundError>> {
  const row = await db.query.backup.findFirst({
    where: and(eq(backup.id, backupId), eq(backup.organizationId, organizationId)),
  });
  if (!row) return Result.err(new NotFoundError({ resource: "backup", id: backupId }));
  return Result.ok(row);
}

export async function createBackup(params: {
  organizationId: string;
  resourceId: string;
}): Promise<Result<ReturnType<typeof formatBackup>, NotFoundError | ConflictError>> {
  const resResult = await validateResource(params.resourceId, params.organizationId);
  if (resResult.isErr()) return resResult;

  const now = new Date();
  const row = {
    id: createId(),
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

  const [inserted] = await db.insert(backup).values(row).returning();
  if (!inserted) {
    return Result.err(new ConflictError({ resource: "backup", detail: "Failed to create backup" }));
  }
  return Result.ok(formatBackup(inserted));
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
): Promise<Result<{ success: true }, NotFoundError>> {
  const backupResult = await validateBackupAccess(backupId, organizationId);
  if (backupResult.isErr()) return backupResult;
  const resResult = await validateResource(targetResourceId, organizationId);
  if (resResult.isErr()) return resResult;
  return Result.ok({ success: true as const });
}

export async function deleteBackup(
  backupId: string,
  organizationId: string,
): Promise<Result<{ success: true }, NotFoundError>> {
  const backupResult = await validateBackupAccess(backupId, organizationId);
  if (backupResult.isErr()) return backupResult;
  await db.delete(backup).where(eq(backup.id, backupId));
  return Result.ok({ success: true as const });
}
