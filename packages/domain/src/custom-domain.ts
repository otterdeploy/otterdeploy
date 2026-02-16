import { db, eq, and } from "@otterstack/db";
import { customDomain } from "@otterstack/db/schema/operations";
import { projectResource } from "@otterstack/db/schema/architecture";

import { DomainError } from "./errors";

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function formatDomain(row: typeof customDomain.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    resourceId: row.resourceId,
    domain: row.domain,
    verified: row.verified,
    sslStatus: row.sslStatus,
    sslExpiresAt: toISOString(row.sslExpiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateResource(resourceId: string, organizationId: string) {
  const row = await db.query.projectResource.findFirst({
    where: eq(projectResource.id, resourceId),
    with: {
      environment: { with: { project: true } },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    throw new DomainError("NOT_FOUND", "Resource not found");
  }
  return row;
}

async function validateDomainAccess(domainId: string, organizationId: string) {
  const row = await db.query.customDomain.findFirst({
    where: and(eq(customDomain.id, domainId), eq(customDomain.organizationId, organizationId)),
  });
  if (!row) throw new DomainError("NOT_FOUND", "Domain not found");
  return row;
}

export async function addDomain(params: {
  organizationId: string;
  resourceId: string;
  domain: string;
}) {
  await validateResource(params.resourceId, params.organizationId);

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    organizationId: params.organizationId,
    resourceId: params.resourceId,
    domain: params.domain,
    verified: false,
    verificationToken: crypto.randomUUID(),
    sslStatus: "pending" as const,
    sslExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(customDomain).values(row);
  return formatDomain(row as typeof customDomain.$inferSelect);
}

export async function verifyDomain(domainId: string, organizationId: string) {
  await validateDomainAccess(domainId, organizationId);

  await db
    .update(customDomain)
    .set({ verified: true, updatedAt: new Date() })
    .where(eq(customDomain.id, domainId));

  const updated = await db.query.customDomain.findFirst({
    where: eq(customDomain.id, domainId),
  });
  return formatDomain(updated!);
}

export async function listDomains(params: {
  organizationId: string;
  resourceId?: string;
}) {
  const conditions = [eq(customDomain.organizationId, params.organizationId)];
  if (params.resourceId) {
    conditions.push(eq(customDomain.resourceId, params.resourceId));
  }

  const rows = await db.query.customDomain.findMany({
    where: and(...conditions),
  });

  return rows.map(formatDomain);
}

export async function removeDomain(domainId: string, organizationId: string) {
  await validateDomainAccess(domainId, organizationId);
  await db.delete(customDomain).where(eq(customDomain.id, domainId));
  return { success: true as const };
}
