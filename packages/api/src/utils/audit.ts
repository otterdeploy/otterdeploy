import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema/operations";

import { createId } from "./helpers";
import { getIpAddress } from "./http";

export type WriteAuditLogEventInput = {
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  headers: Headers;
};

export async function writeAuditLogEvent(input: WriteAuditLogEventInput): Promise<string> {
  const id = createId();
  await db.insert(auditLog).values({
    id,
    organizationId: input.organizationId,
    userId: input.userId,
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
