import { db } from "@otterstack/db";
import { auditLog } from "@otterstack/db/schema/operations";

export type AuditContext = {
  userId: string;
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
  const id = crypto.randomUUID();
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
