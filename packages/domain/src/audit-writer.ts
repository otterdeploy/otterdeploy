import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema/operations";
import { createId } from "@otterdeploy/utils";

export type AuditContext = {
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  actorType?: "user" | "system";
  actorLabel?: string | null;
};

export async function writeAuditLog(
  organizationId: string,
  audit: AuditContext,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const id = createId();
  const inferredActorType = audit.actorType ?? (audit.userId ? "user" : "system");
  const actorType = inferredActorType === "user" && !audit.userId ? "system" : inferredActorType;
  const actorUserId = actorType === "user" ? audit.userId : null;
  const actorLabel =
    audit.actorLabel?.trim() ||
    (actorType === "system" ? "system" : actorUserId ? "user" : "unknown");

  await db.insert(auditLog).values({
    id,
    organizationId,
    actorType,
    actorUserId,
    actorLabel,
    userId: actorUserId,
    action,
    entityType,
    entityId,
    metadata,
    ipAddress: audit.ipAddress,
    userAgent: audit.userAgent,
  });
  return id;
}
