import { db, eq, and, desc, sql } from "@otterstack/db";
import { auditLog } from "@otterstack/db/schema/operations";

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

export async function listAuditLogs(params: {
  organizationId: string;
  action?: string;
  actorUserId?: string;
  page: number;
  pageSize: number;
}) {
  const { page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(auditLog.organizationId, params.organizationId)];
  if (params.action) conditions.push(eq(auditLog.action, params.action));
  if (params.actorUserId) conditions.push(eq(auditLog.userId, params.actorUserId));

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
}
