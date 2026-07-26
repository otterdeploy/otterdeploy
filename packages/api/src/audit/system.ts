import { insertChainedAuditRow } from "./chain";

/**
 * Append a non-request control-plane action to the same durable, tamper-
 * evident audit trail used by oRPC. Background work (BullMQ jobs, the
 * builder) has no request logger/audit plugin envelope, so it writes the
 * normalized system actor row directly through the same chained-insert path
 * the pg-drain uses — every row in `audit_log` is chained regardless of
 * which of the three writers (oRPC drain, this, terminal.ts) produced it.
 *
 * `correlationId`/`causationId` are optional so a caller with no logical
 * operation to tie back to (a cron job with no originating request) still
 * gets a row — just an uncorrelated one. A caller that DOES know which
 * user action it's completing (e.g. the builder finishing a deploy
 * triggered by an oRPC call) should pass the correlationId that call
 * generated — see packages/api/src/index.ts `traceProcedure` and
 * apps/builder/src/handler.ts for the concrete propagation path.
 */
export async function recordSystemAudit(input: {
  action: string;
  outcome: "success" | "failure";
  target: { type: string; id: string; [key: string]: unknown };
  reason?: string;
  correlationId?: string | null;
  causationId?: string | null;
  organizationId?: string | null;
}): Promise<void> {
  await insertChainedAuditRow({
    organizationId: input.organizationId ?? null,
    timestamp: new Date(),
    action: input.action,
    actorType: "system",
    actorId: "otterdeploy-control-plane",
    actorEmail: null,
    actorLabel: "OtterDeploy control plane",
    targetType: input.target.type,
    targetId: input.target.id,
    target: input.target,
    outcome: input.outcome,
    reason: input.reason?.slice(0, 500) ?? null,
    durationMs: null,
    changes: null,
    requestId: null,
    traceId: null,
    ip: null,
    userAgent: null,
    correlationId: input.correlationId ?? null,
    causationId: input.causationId ?? null,
    version: 1,
    idempotencyKey: null,
  });
}
