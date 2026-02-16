import { Result } from "better-result";
import { db, eq, and } from "@otterstack/db";
import { customDomain } from "@otterstack/db/schema/operations";
import { projectResource } from "@otterstack/db/schema/architecture";

import { NotFoundError, ConflictError } from "./errors";

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

async function validateResource(
  resourceId: string,
  organizationId: string,
): Promise<Result<typeof projectResource.$inferSelect, NotFoundError>> {
  const row = await db.query.projectResource.findFirst({
    where: eq(projectResource.id, resourceId),
    with: {
      environment: { with: { project: true } },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    return Result.err(new NotFoundError({ resource: "resource", id: resourceId }));
  }
  return Result.ok(row);
}

async function validateDomainAccess(
  domainId: string,
  organizationId: string,
): Promise<Result<typeof customDomain.$inferSelect, NotFoundError>> {
  const row = await db.query.customDomain.findFirst({
    where: and(eq(customDomain.id, domainId), eq(customDomain.organizationId, organizationId)),
  });
  if (!row) return Result.err(new NotFoundError({ resource: "domain", id: domainId }));
  return Result.ok(row);
}

export async function addDomain(params: {
  organizationId: string;
  resourceId: string;
  domain: string;
}): Promise<Result<ReturnType<typeof formatDomain>, NotFoundError | ConflictError>> {
  const resResult = await validateResource(params.resourceId, params.organizationId);
  if (resResult.isErr()) return resResult;

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

  const [inserted] = await db.insert(customDomain).values(row).returning();
  if (!inserted) {
    return Result.err(new ConflictError({ resource: "domain", detail: "Failed to add domain" }));
  }
  return Result.ok(formatDomain(inserted));
}

export async function verifyDomain(
  domainId: string,
  organizationId: string,
): Promise<Result<ReturnType<typeof formatDomain>, NotFoundError>> {
  const accessResult = await validateDomainAccess(domainId, organizationId);
  if (accessResult.isErr()) return accessResult;

  await db
    .update(customDomain)
    .set({ verified: true, updatedAt: new Date() })
    .where(eq(customDomain.id, domainId));

  const updated = await db.query.customDomain.findFirst({
    where: eq(customDomain.id, domainId),
  });
  return Result.ok(formatDomain(updated!));
}

export async function listDomains(params: { organizationId: string; resourceId?: string }) {
  const conditions = [eq(customDomain.organizationId, params.organizationId)];
  if (params.resourceId) {
    conditions.push(eq(customDomain.resourceId, params.resourceId));
  }

  const rows = await db.query.customDomain.findMany({
    where: and(...conditions),
  });

  return rows.map(formatDomain);
}

export async function removeDomain(
  domainId: string,
  organizationId: string,
): Promise<Result<{ success: true }, NotFoundError>> {
  const accessResult = await validateDomainAccess(domainId, organizationId);
  if (accessResult.isErr()) return accessResult;

  await db.delete(customDomain).where(eq(customDomain.id, domainId));
  return Result.ok({ success: true as const });
}
