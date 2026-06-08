import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";
import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";

import { orgScopedProcedure } from "../..";

export const auditRouter = {
  list: orgScopedProcedure.audit.list.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;

    const conds: SQL[] = [eq(auditLog.organizationId, orgId)];
    if (input.action) conds.push(eq(auditLog.action, input.action));
    if (input.actorId) conds.push(eq(auditLog.actorId, input.actorId));
    if (input.outcome) conds.push(eq(auditLog.outcome, input.outcome));
    if (input.targetType) conds.push(eq(auditLog.targetType, input.targetType));
    if (input.from) conds.push(gte(auditLog.timestamp, new Date(input.from)));
    if (input.to) conds.push(lte(auditLog.timestamp, new Date(input.to)));
    if (input.q) {
      const like = `%${input.q}%`;
      const search = or(
        ilike(auditLog.action, like),
        ilike(auditLog.actorEmail, like),
        ilike(auditLog.actorId, like),
        ilike(auditLog.targetId, like),
      );
      if (search) conds.push(search);
    }
    const where = and(...conds);

    const [rows, [totalRow], [failedRow], [deniedRow]] = await Promise.all([
      db
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.timestamp))
        .limit(input.limit)
        .offset(input.offset),
      db.select({ n: count() }).from(auditLog).where(where),
      db
        .select({ n: count() })
        .from(auditLog)
        .where(and(where, eq(auditLog.outcome, "failure"))),
      db
        .select({ n: count() })
        .from(auditLog)
        .where(and(where, eq(auditLog.outcome, "denied"))),
    ]);

    const total = totalRow?.n ?? 0;

    return {
      items: rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        action: r.action,
        actorType: r.actorType,
        actorId: r.actorId,
        actorEmail: r.actorEmail,
        actorLabel: r.actorLabel,
        targetType: r.targetType,
        targetId: r.targetId,
        target: r.target ?? null,
        outcome: r.outcome,
        reason: r.reason,
        durationMs: r.durationMs,
        changes: r.changes ?? null,
        ip: r.ip,
        userAgent: r.userAgent,
        correlationId: r.correlationId,
        causationId: r.causationId,
      })),
      total,
      counts: {
        total,
        failed: failedRow?.n ?? 0,
        denied: deniedRow?.n ?? 0,
      },
    };
  }),
};
