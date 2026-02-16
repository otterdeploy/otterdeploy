import * as z from "zod";
import { db, eq, and, desc, sql } from "@otterstack/db";
import { backup } from "@otterstack/db/schema/operations";

import { orgProcedure, orgAdminProcedure } from "../index";
import { createId, toISOString, paginationMeta } from "../utils/helpers";
import { validateResourceAccess, validateBackupAccess } from "../utils/ownership";

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
    updatedAt: row.createdAt.toISOString(), // backup table has no updatedAt, use createdAt
  };
}

export const backupRouter = {
  create: orgAdminProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateResourceAccess(input.resourceId, context.organizationId);

      const now = new Date();
      const row = {
        id: createId(),
        organizationId: context.organizationId,
        resourceId: input.resourceId,
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
    }),

  list: orgProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        resourceId: z.string().min(1).optional(),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(10),
      }),
    )
    .handler(async ({ context, input }) => {
      const { page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions = [eq(backup.organizationId, context.organizationId)];
      if (input.resourceId) conditions.push(eq(backup.resourceId, input.resourceId));

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
    }),

  restore: orgAdminProcedure
    .input(
      z.object({
        backupId: z.string().min(1),
        targetResourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateBackupAccess(input.backupId, context.organizationId);
      await validateResourceAccess(input.targetResourceId, context.organizationId);
      return { success: true as const };
    }),

  delete: orgAdminProcedure
    .input(
      z.object({
        backupId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateBackupAccess(input.backupId, context.organizationId);
      await db.delete(backup).where(eq(backup.id, input.backupId));
      return { success: true as const };
    }),
};
