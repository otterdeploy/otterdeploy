import { Result } from "better-result";
import { db, eq, and } from "@otterdeploy/db";
import { gitProvider } from "@otterdeploy/db/schema/infrastructure";
import { upsertSecretReference } from "@otterdeploy/secrets";

import { createId } from "@otterdeploy/utils";

import { NotFoundError, ConflictError, BadRequestError } from "./errors";
import { type AuditContext, writeAuditLog } from "./audit-writer";
import { pickDefined } from "./utils";

function formatGitProvider(row: typeof gitProvider.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    name: row.name,
    appId: row.appId ?? null,
    clientId: row.clientId ?? null,
    installationId: row.installationId ?? null,
    hasClientSecret: !!row.clientSecretReferenceId,
    hasWebhookSecret: !!row.webhookSecretReferenceId,
    clientSecretReferenceId: row.clientSecretReferenceId ?? null,
    webhookSecretReferenceId: row.webhookSecretReferenceId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateAccess(
  providerId: string,
  organizationId: string,
): Promise<Result<typeof gitProvider.$inferSelect, NotFoundError>> {
  const row = await db.query.gitProvider.findFirst({
    where: and(eq(gitProvider.id, providerId), eq(gitProvider.organizationId, organizationId)),
  });
  if (!row) return Result.err(new NotFoundError({ resource: "git_provider", id: providerId }));
  return Result.ok(row);
}

export async function createGitProvider(params: {
  organizationId: string;
  type: string;
  name: string;
  appId?: string;
  clientId?: string;
  clientSecret?: string;
  installationId?: string;
  webhookSecret?: string;
  audit: AuditContext;
}): Promise<Result<ReturnType<typeof formatGitProvider>, ConflictError>> {
  const providerId = createId();
  const now = new Date();

  const clientSecret = params.clientSecret
    ? await upsertSecretReference({
        organizationId: params.organizationId,
        kind: "git_client_secret",
        logicalScope: "organization",
        logicalScopeId: params.organizationId,
        key: `${providerId}.client_secret`,
        plaintext: params.clientSecret,
        actorUserId: params.audit.userId ?? "system",
      })
    : null;

  const webhookSecret = params.webhookSecret
    ? await upsertSecretReference({
        organizationId: params.organizationId,
        kind: "git_webhook_secret",
        logicalScope: "organization",
        logicalScopeId: params.organizationId,
        key: `${providerId}.webhook_secret`,
        plaintext: params.webhookSecret,
        actorUserId: params.audit.userId ?? "system",
      })
    : null;

  const row = {
    id: providerId,
    organizationId: params.organizationId,
    type: params.type,
    name: params.name,
    appId: params.appId ?? null,
    clientId: params.clientId ?? null,
    clientSecretReferenceId: clientSecret?.reference.id ?? null,
    installationId: params.installationId ?? null,
    webhookSecretReferenceId: webhookSecret?.reference.id ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const [inserted] = await db.insert(gitProvider).values(row).returning();
  if (!inserted) {
    return Result.err(new ConflictError({ resource: "git_provider", detail: "Failed to create git provider" }));
  }

  await writeAuditLog(params.organizationId, params.audit, "git_provider.created", "git_provider", providerId, {
    hasClientSecret: !!params.clientSecret,
    hasWebhookSecret: !!params.webhookSecret,
  });

  return Result.ok(formatGitProvider(inserted));
}

export async function updateGitProvider(params: {
  organizationId: string;
  providerId: string;
  type?: string;
  name?: string;
  appId?: string | null;
  clientId?: string | null;
  clientSecret?: string;
  installationId?: string | null;
  webhookSecret?: string;
  audit: AuditContext;
}): Promise<Result<ReturnType<typeof formatGitProvider>, NotFoundError>> {
  const existingResult = await validateAccess(params.providerId, params.organizationId);
  if (existingResult.isErr()) return existingResult;
  const existing = existingResult.value;

  let clientSecretReferenceId = existing.clientSecretReferenceId;
  if (params.clientSecret !== undefined) {
    const secret = await upsertSecretReference({
      organizationId: params.organizationId,
      kind: "git_client_secret",
      logicalScope: "organization",
      logicalScopeId: params.organizationId,
      key: `${existing.id}.client_secret`,
      plaintext: params.clientSecret,
      actorUserId: params.audit.userId ?? "system",
    });
    clientSecretReferenceId = secret.reference.id;
  }

  let webhookSecretReferenceId = existing.webhookSecretReferenceId;
  if (params.webhookSecret !== undefined) {
    const secret = await upsertSecretReference({
      organizationId: params.organizationId,
      kind: "git_webhook_secret",
      logicalScope: "organization",
      logicalScopeId: params.organizationId,
      key: `${existing.id}.webhook_secret`,
      plaintext: params.webhookSecret,
      actorUserId: params.audit.userId ?? "system",
    });
    webhookSecretReferenceId = secret.reference.id;
  }

  await db
    .update(gitProvider)
    .set({
      ...pickDefined({
        type: params.type,
        name: params.name,
        appId: params.appId,
        clientId: params.clientId,
        installationId: params.installationId,
      }),
      clientSecretReferenceId,
      webhookSecretReferenceId,
      updatedAt: new Date(),
    })
    .where(eq(gitProvider.id, existing.id));

  await writeAuditLog(params.organizationId, params.audit, "git_provider.updated", "git_provider", existing.id, {
    rotatedClientSecret: params.clientSecret !== undefined,
    rotatedWebhookSecret: params.webhookSecret !== undefined,
  });

  const updated = await db.query.gitProvider.findFirst({
    where: eq(gitProvider.id, existing.id),
  });

  return Result.ok(formatGitProvider(updated!));
}

export async function listGitProviders(organizationId: string) {
  const rows = await db.query.gitProvider.findMany({
    where: eq(gitProvider.organizationId, organizationId),
  });
  return rows.map(formatGitProvider);
}

export async function deleteGitProvider(
  providerId: string,
  organizationId: string,
  audit: AuditContext,
): Promise<Result<{ success: true }, NotFoundError>> {
  const existingResult = await validateAccess(providerId, organizationId);
  if (existingResult.isErr()) return existingResult;
  const existing = existingResult.value;

  await db.delete(gitProvider).where(eq(gitProvider.id, providerId));

  await writeAuditLog(organizationId, audit, "git_provider.deleted", "git_provider", existing.id, {});

  return Result.ok({ success: true as const });
}

export async function rotateGitProviderSecret(params: {
  organizationId: string;
  providerId: string;
  reason: string;
  clientSecret?: string;
  webhookSecret?: string;
  audit: AuditContext;
}): Promise<Result<ReturnType<typeof formatGitProvider>, NotFoundError | BadRequestError>> {
  if (!params.clientSecret && !params.webhookSecret) {
    return Result.err(new BadRequestError({ field: "secrets", message: "Provide clientSecret or webhookSecret to rotate" }));
  }

  const existingResult = await validateAccess(params.providerId, params.organizationId);
  if (existingResult.isErr()) return existingResult;
  const existing = existingResult.value;

  let clientSecretReferenceId = existing.clientSecretReferenceId;
  let webhookSecretReferenceId = existing.webhookSecretReferenceId;

  if (params.clientSecret) {
    const secret = await upsertSecretReference({
      organizationId: params.organizationId,
      kind: "git_client_secret",
      logicalScope: "organization",
      logicalScopeId: params.organizationId,
      key: `${existing.id}.client_secret`,
      plaintext: params.clientSecret,
      actorUserId: params.audit.userId ?? "system",
    });
    clientSecretReferenceId = secret.reference.id;
  }

  if (params.webhookSecret) {
    const secret = await upsertSecretReference({
      organizationId: params.organizationId,
      kind: "git_webhook_secret",
      logicalScope: "organization",
      logicalScopeId: params.organizationId,
      key: `${existing.id}.webhook_secret`,
      plaintext: params.webhookSecret,
      actorUserId: params.audit.userId ?? "system",
    });
    webhookSecretReferenceId = secret.reference.id;
  }

  await db
    .update(gitProvider)
    .set({
      clientSecretReferenceId,
      webhookSecretReferenceId,
      updatedAt: new Date(),
    })
    .where(eq(gitProvider.id, existing.id));

  await writeAuditLog(params.organizationId, params.audit, "secret.rotated", "git_provider", existing.id, {
    reason: params.reason,
    rotatedClientSecret: !!params.clientSecret,
    rotatedWebhookSecret: !!params.webhookSecret,
  });

  const updated = await db.query.gitProvider.findFirst({
    where: eq(gitProvider.id, existing.id),
  });

  return Result.ok(formatGitProvider(updated!));
}
