import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema";

/** Append a non-request control-plane action to the same durable audit trail
 * used by oRPC. Background work has no request logger/audit plugin envelope,
 * so it writes the normalized system actor row directly. */
export async function recordSystemAudit(input: {
  action: string;
  outcome: "success" | "failure";
  target: { type: string; id: string; [key: string]: unknown };
  reason?: string;
}): Promise<void> {
  await db.insert(auditLog).values({
    action: input.action,
    actorType: "system",
    actorId: "otterdeploy-control-plane",
    actorLabel: "OtterDeploy control plane",
    targetType: input.target.type,
    targetId: input.target.id,
    target: input.target,
    outcome: input.outcome,
    reason: input.reason?.slice(0, 500) ?? null,
  });
}
