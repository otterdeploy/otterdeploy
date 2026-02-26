import { db, eq, and, desc, sql } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema/operations";

function formatAuditLog(row: typeof auditLog.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    actorType: row.actorType === "system" ? "system" : "user",
    actorUserId: row.actorUserId ?? row.userId ?? null,
    actorLabel: row.actorLabel ?? (row.userId ? "user" : "system"),
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
  actorType?: "user" | "system";
  page: number;
  pageSize: number;
}) {
  const { page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(auditLog.organizationId, params.organizationId)];
  if (params.action) conditions.push(eq(auditLog.action, params.action));
  if (params.actorUserId) {
    conditions.push(eq(auditLog.actorUserId, params.actorUserId));
  }
  if (params.actorType) {
    conditions.push(eq(auditLog.actorType, params.actorType));
  }

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
