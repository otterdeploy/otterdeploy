import * as z from "zod";
import { db, eq, and, desc, sql } from "@otterstack/db";
import { auditLog } from "@otterstack/db/schema/operations";

import { orgAdminProcedure } from "../index";
import { paginationMeta } from "../utils/helpers";

function formatAuditLog(row: typeof auditLog.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    actorUserId: row.userId ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId ?? null,
    metadata: row.metadata,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const auditRouter = {
  list: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        action: z.string().optional(),
        actorUserId: z.string().min(1).optional(),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(10),
      }),
    )
    .handler(async ({ context, input }) => {
      const { page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions = [eq(auditLog.organizationId, context.organizationId)];
      if (input.action) conditions.push(eq(auditLog.action, input.action));
      if (input.actorUserId) conditions.push(eq(auditLog.userId, input.actorUserId));

      const whereClause = and(...conditions);

      const [items, [countRow]] = await Promise.all([
        db.query.auditLog.findMany({
          where: whereClause,
          orderBy: [desc(auditLog.createdAt)],
          limit: pageSize,
          offset,
        }),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(auditLog)
          .where(whereClause!),
      ]);

      return {
        items: items.map(formatAuditLog),
        meta: paginationMeta(page, pageSize, countRow?.count ?? 0),
      };
    }),
};
