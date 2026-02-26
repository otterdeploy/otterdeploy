import { db } from "@otterdeploy/db";
import { auditLog } from "@otterdeploy/db/schema/operations";
import { createId } from "@otterdeploy/utils";

export type AuditContext = {
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
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
  await db.insert(auditLog).values({
    id,
    organizationId,
    userId: audit.userId,
    action,
    entityType,
    entityId,
    metadata,
    ipAddress: audit.ipAddress,
    userAgent: audit.userAgent,
  });
  return id;
}
