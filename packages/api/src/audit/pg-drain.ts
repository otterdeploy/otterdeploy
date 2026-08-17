import type { DrainContext } from "evlog";

/**
 * Postgres audit drain: persists evlog audit events into the `audit_log`
 * table. Wrap with `auditOnly(...)` so only events carrying `event.audit`
 * reach it, and register it as a plugin alongside the default drain so normal
 * logging is untouched (see apps/server bootstrap).
 *
 * Errors here are isolated by evlog's drain runner, so a transient DB blip
 * can't fail the originating request. `idempotencyKey` is unique, so retries
 * across drains `onConflictDoNothing` instead of duplicating rows.
 */
import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";
import { isJsonObject } from "@otterdeploy/shared/json";

type AuditEvent = DrainContext["event"];
type AuditEnvelope = NonNullable<AuditEvent["audit"]>;

/** Actor identity columns from the audit envelope's actor. */
function actorColumns(actor: AuditEnvelope["actor"]) {
  return {
    actorType: actor.type,
    actorId: actor.id,
    actorEmail: actor.email ?? null,
    actorLabel: actor.displayName ?? null,
  };
}

/**
 * `context` is not a typed top-level field on evlog's WideEvent, but the
 * auditEnricher mirrors the tenant there; read it defensively as a fallback.
 */
function tenantIdFrom(context: unknown): string | null {
  if (typeof context !== "object" || context === null) return null;
  const tenantId = "tenantId" in context ? context.tenantId : undefined;
  return typeof tenantId === "string" ? tenantId : null;
}

/**
 * Request/trace context columns. `organizationId` falls back to the event's
 * top-level context when the envelope omits a tenant.
 */
function contextColumns(a: AuditEnvelope, event: AuditEvent) {
  const c = a.context;
  return {
    organizationId: c?.tenantId ?? tenantIdFrom(event.context),
    requestId: c?.requestId ?? null,
    traceId: c?.traceId ?? null,
    ip: c?.ip ?? null,
    userAgent: c?.userAgent ?? null,
  };
}

/**
 * Target columns. Handlers set `target` top-level via
 * context.log.set({ target }); the audit envelope may also carry one. Prefer
 * the envelope's. Both are JSON by construction, so `isJsonObject` is the
 * jsonb write boundary.
 */
function targetColumns(a: AuditEnvelope, event: AuditEvent) {
  const rawTarget = a.target ?? event.target;
  const target = isJsonObject(rawTarget) ? rawTarget : undefined;
  return {
    targetType: typeof target?.type === "string" ? target.type : null,
    targetId: typeof target?.id === "string" ? target.id : null,
    target: target ?? null,
  };
}

/** Map an evlog audit event to a row for the `audit_log` table. */
function toAuditRow(event: AuditEvent, a: AuditEnvelope) {
  return {
    timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
    action: a.action,
    ...actorColumns(a.actor),
    ...contextColumns(a, event),
    ...targetColumns(a, event),
    outcome: a.outcome,
    reason: a.reason ?? null,
    durationMs: typeof event.durationMs === "number" ? Math.round(event.durationMs) : null,
    // evlog types before/after as `unknown`; audit diffs are JSON by
    // construction (auditDiff output), so this is the jsonb write boundary.
    changes: isJsonObject(a.changes) ? a.changes : null,
    correlationId: a.correlationId ?? null,
    causationId: a.causationId ?? null,
    version: a.version ?? 1,
    idempotencyKey: a.idempotencyKey ?? null,
  };
}

export function createAuditPgDrain() {
  return async (ctx: DrainContext): Promise<void> => {
    const event = ctx.event;
    const a = event.audit;
    if (!a) return; // `auditOnly` already guards, but stay defensive.

    await db.insert(auditLog).values(toAuditRow(event, a)).onConflictDoNothing();
  };
}
