import type { DrainContext } from "evlog";

/**
 * Postgres audit drain — persists evlog audit events into the `audit_log`
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

type AuditActorType = "user" | "system" | "api" | "agent";
type AuditOutcome = "success" | "failure" | "denied";

interface EventTarget {
  type?: string;
  id?: string;
  [k: string]: unknown;
}

type AuditEvent = DrainContext["event"];
type AuditEnvelope = NonNullable<AuditEvent["audit"]>;

/** Actor identity columns from the audit envelope's actor. */
function actorColumns(actor: AuditEnvelope["actor"]) {
  return {
    actorType: actor.type as AuditActorType,
    actorId: actor.id,
    actorEmail: actor.email ?? null,
    actorLabel: actor.displayName ?? null,
  };
}

/**
 * Request/trace context columns. `organizationId` falls back to the event's
 * top-level context when the envelope omits a tenant.
 */
function contextColumns(a: AuditEnvelope, event: AuditEvent) {
  const c = a.context;
  // `context` is not a typed top-level field on evlog's WideEvent, but the
  // auditEnricher mirrors the tenant there; read it defensively as a fallback.
  const eventContext = event.context as { tenantId?: string } | undefined;
  return {
    organizationId: c?.tenantId ?? eventContext?.tenantId ?? null,
    requestId: c?.requestId ?? null,
    traceId: c?.traceId ?? null,
    ip: c?.ip ?? null,
    userAgent: c?.userAgent ?? null,
  };
}

/** Map an evlog audit event to a row for the `audit_log` table. */
function toAuditRow(event: AuditEvent, a: AuditEnvelope) {
  // Handlers set `target` top-level via context.log.set({ target }); the
  // audit envelope may also carry one. Prefer the envelope's.
  const target = (a.target ?? event.target) as EventTarget | undefined;

  return {
    timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
    action: a.action,
    ...actorColumns(a.actor),
    ...contextColumns(a, event),
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    target: target ?? null,
    outcome: a.outcome as AuditOutcome,
    reason: a.reason ?? null,
    durationMs: typeof event.durationMs === "number" ? Math.round(event.durationMs) : null,
    changes: a.changes ?? null,
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
