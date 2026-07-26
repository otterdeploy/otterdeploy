/**
 * Durable audit trail for shell open/close (od-5j8.9 acceptance: "creates a
 * durable session audit record"). Written directly to the audit_log table —
 * same shape `./system.ts` uses for background/system actions — rather than
 * through the oRPC `context.log.audit` pipeline, because the WebSocket
 * open/close events fire from `hono/ws` lifecycle callbacks that run after
 * the originating HTTP upgrade request's wide event has already flushed (see
 * the "streaming-tolerant logger" note in apps/server/src/index.ts). Writing
 * the row directly means the record doesn't race that flush.
 */
import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";

export async function recordTerminalShellAudit(input: {
  action: "terminal.open" | "terminal.close";
  organizationId: string;
  userId: string;
  target: { kind: "container" | "host"; id: string };
  outcome: "success" | "failure" | "denied";
  reason?: string;
}): Promise<void> {
  await db.insert(auditLog).values({
    organizationId: input.organizationId,
    action: input.action,
    actorType: "user",
    actorId: input.userId,
    targetType: input.target.kind,
    targetId: input.target.id,
    target: { kind: input.target.kind, id: input.target.id },
    outcome: input.outcome,
    reason: input.reason?.slice(0, 500) ?? null,
  });
}
