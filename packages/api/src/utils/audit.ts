import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema/operations";

import { createId } from "./helpers";
import { getIpAddress } from "./http";

export type WriteAuditLogEventInput = {
  organizationId: string;
  userId: string | null;
  actorType?: "user" | "system";
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  headers: Headers;
};

export async function writeAuditLogEvent(input: WriteAuditLogEventInput): Promise<string> {
  const id = createId();
  const inferredActorType = input.actorType ?? (input.userId ? "user" : "system");
  const actorType = inferredActorType === "user" && !input.userId ? "system" : inferredActorType;
  const actorUserId = actorType === "user" ? input.userId : null;
  const actorLabel =
    input.actorLabel?.trim() ||
    (actorType === "system" ? "system" : actorUserId ? "user" : "unknown");

  await db.insert(auditLog).values({
    id,
    organizationId: input.organizationId,
    actorType,
    actorUserId,
    actorLabel,
    userId: actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
    ipAddress: getIpAddress(input.headers),
    userAgent: input.headers.get("user-agent"),
    createdAt: new Date(),
  });
  return id;
}
