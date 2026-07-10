import type { AuditLogId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";
import { and, count, desc, eq, gte, ilike, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";

import { orgScopedProcedure } from "../..";

type AuditRow = typeof auditLog.$inferSelect;

/** Shape a DB row into the contract's audit event (Date → ISO, jsonb → null). */
function toAuditEvent(r: AuditRow) {
  return {
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
  };
}

/** Org scope + optional time window — shared by `list` and `distinct`. */
function windowConds(orgId: string, from?: string, to?: string): SQL[] {
  const conds: SQL[] = [eq(auditLog.organizationId, orgId)];
  if (from) conds.push(gte(auditLog.timestamp, new Date(from)));
  if (to) conds.push(lte(auditLog.timestamp, new Date(to)));
  return conds;
}

export const auditRouter = {
  list: orgScopedProcedure.audit.list.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;

    const conds = windowConds(orgId, input.from, input.to);
    if (input.action) conds.push(eq(auditLog.action, input.action));
    if (input.actorId) conds.push(eq(auditLog.actorId, input.actorId));
    if (input.outcome) conds.push(eq(auditLog.outcome, input.outcome));
    if (input.targetType) conds.push(eq(auditLog.targetType, input.targetType));
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
      items: rows.map(toAuditEvent),
      total,
      counts: {
        total,
        failed: failedRow?.n ?? 0,
        denied: deniedRow?.n ?? 0,
      },
    };
  }),

  /** Project-scoped feed for the graph workspace's Activity tab. The audit row
   *  has no project column — scope is derived from the target: either the
   *  event targeted the project itself (`targetId = projectId`) or its target
   *  payload carries the project (`target->>'projectId'`, the shape resource
   *  mutations set). Org filter stays the cross-tenant guard. */
  listForProject: orgScopedProcedure.audit.listForProject.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;

    const projectScope = or(
      eq(auditLog.targetId, input.projectId),
      sql`${auditLog.target} ->> 'projectId' = ${input.projectId}`,
    );
    const where = and(eq(auditLog.organizationId, orgId), projectScope);

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.timestamp))
        .limit(input.limit)
        .offset(input.offset),
      db.select({ n: count() }).from(auditLog).where(where),
    ]);

    return { items: rows.map(toAuditEvent), total: totalRow?.n ?? 0 };
  }),

  /** Cheap DISTINCT scans over the window for the filter dropdowns. Bounded by
   *  the (org, timestamp) index + hard limits, so it stays a small payload even
   *  on busy orgs. */
  distinct: orgScopedProcedure.audit.distinct.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;
    const where = and(...windowConds(orgId, input.from, input.to));

    const [actorRows, actionRows, targetRows] = await Promise.all([
      db
        .selectDistinct({
          id: auditLog.actorId,
          type: auditLog.actorType,
          email: auditLog.actorEmail,
          label: auditLog.actorLabel,
        })
        .from(auditLog)
        .where(where)
        .limit(200),
      db
        .selectDistinct({ action: auditLog.action })
        .from(auditLog)
        .where(where)
        .orderBy(auditLog.action)
        .limit(300),
      db
        .selectDistinct({ targetType: auditLog.targetType })
        .from(auditLog)
        .where(and(where, isNotNull(auditLog.targetType)))
        .limit(100),
    ]);

    // The DISTINCT is over the (id, type, email, label) tuple, so an actor
    // whose label/email changed mid-window appears twice — collapse by id,
    // preferring the row that carries a label.
    const actors = new Map<string, (typeof actorRows)[number]>();
    for (const a of actorRows) {
      const prev = actors.get(a.id);
      if (!prev || (!prev.label && a.label)) actors.set(a.id, a);
    }

    return {
      actors: [...actors.values()].sort((a, b) =>
        (a.label ?? a.email ?? a.id).localeCompare(b.label ?? b.email ?? b.id),
      ),
      actions: actionRows.map((r) => r.action),
      targetTypes: targetRows
        .map((r) => r.targetType)
        .filter((t): t is string => t !== null)
        .sort(),
    };
  }),

  /** Events related to one logical operation: siblings sharing the
   *  correlationId, plus the causing event (causationId is an event id).
   *  Org-scoped, so cross-tenant ids resolve to nothing. */
  byCorrelation: orgScopedProcedure.audit.byCorrelation.handler(async ({ input, context }) => {
    const orgId = context.activeOrganizationId;

    const rel: SQL[] = [];
    if (input.correlationId) rel.push(eq(auditLog.correlationId, input.correlationId));
    // causationId is stored as free text (it names the causing event), so cast
    // to the branded id type for the primary-key comparison.
    if (input.causationId) rel.push(eq(auditLog.id, input.causationId as AuditLogId));
    if (rel.length === 0) return { items: [] };

    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, orgId), or(...rel)))
      .orderBy(desc(auditLog.timestamp))
      .limit(input.limit);

    return { items: rows.map(toAuditEvent) };
  }),
};
