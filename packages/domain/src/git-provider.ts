import { db, eq, and } from "@otterstack/db";
import { gitProvider } from "@otterstack/db/schema/infrastructure";
import { upsertSecretReference } from "@otterstack/secrets";

import { DomainError } from "./errors";
import { type AuditContext, writeAuditLog } from "./audit-writer";
import { encodeLegacySecret } from "./legacy-secret";

function formatGitProvider(row: typeof gitProvider.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    name: row.name,
    appId: row.appId ?? null,
    clientId: row.clientId ?? null,
    installationId: row.installationId ?? null,
    hasClientSecret: !!row.clientSecretReferenceId || !!row.encryptedClientSecret,
    hasWebhookSecret: !!row.webhookSecretReferenceId || !!row.encryptedWebhookSecret,
    clientSecretReferenceId: row.clientSecretReferenceId ?? null,
    webhookSecretReferenceId: row.webhookSecretReferenceId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateAccess(providerId: string, organizationId: string) {
  const row = await db.query.gitProvider.findFirst({
    where: and(eq(gitProvider.id, providerId), eq(gitProvider.organizationId, organizationId)),
  });
  if (!row) throw new DomainError("NOT_FOUND", "Git provider not found");
  return row;
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
}) {
  const providerId = crypto.randomUUID();
  const now = new Date();

  const clientSecret = params.clientSecret
    ? await upsertSecretReference({
        organizationId: params.organizationId,
        kind: "git_client_secret",
        logicalScope: "organization",
        logicalScopeId: params.organizationId,
        key: `${providerId}.client_secret`,
        plaintext: params.clientSecret,
        actorUserId: params.audit.userId,
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
        actorUserId: params.audit.userId,
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
    encryptedClientSecret: params.clientSecret ? encodeLegacySecret(params.clientSecret) : null,
    installationId: params.installationId ?? null,
    webhookSecretReferenceId: webhookSecret?.reference.id ?? null,
    encryptedWebhookSecret: params.webhookSecret ? encodeLegacySecret(params.webhookSecret) : null,
    createdAt: now,
    updatedAt: now,
  };

  const [inserted] = await db.insert(gitProvider).values(row).returning();
  if (!inserted) {
    throw new DomainError("CONFLICT", "Failed to create git provider");
  }

  await writeAuditLog(
    params.organizationId,
    params.audit,
    "git_provider.created",
    "git_provider",
    providerId,
    {
      hasClientSecret: !!params.clientSecret,
      hasWebhookSecret: !!params.webhookSecret,
    },
  );

  return formatGitProvider(inserted);
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
}) {
  const existing = await validateAccess(params.providerId, params.organizationId);

  let clientSecretReferenceId = existing.clientSecretReferenceId;
  let encryptedClientSecret = existing.encryptedClientSecret;
  if (params.clientSecret !== undefined) {
    const secret = await upsertSecretReference({
      organizationId: params.organizationId,
      kind: "git_client_secret",
      logicalScope: "organization",
      logicalScopeId: params.organizationId,
      key: `${existing.id}.client_secret`,
      plaintext: params.clientSecret,
      actorUserId: params.audit.userId,
    });
    clientSecretReferenceId = secret.reference.id;
    encryptedClientSecret = encodeLegacySecret(params.clientSecret);
  }

  let webhookSecretReferenceId = existing.webhookSecretReferenceId;
  let encryptedWebhookSecret = existing.encryptedWebhookSecret;
  if (params.webhookSecret !== undefined) {
    const secret = await upsertSecretReference({
      organizationId: params.organizationId,
      kind: "git_webhook_secret",
      logicalScope: "organization",
      logicalScopeId: params.organizationId,
      key: `${existing.id}.webhook_secret`,
      plaintext: params.webhookSecret,
      actorUserId: params.audit.userId,
    });
    webhookSecretReferenceId = secret.reference.id;
    encryptedWebhookSecret = encodeLegacySecret(params.webhookSecret);
  }

  await db
    .update(gitProvider)
    .set({
      type: params.type ?? existing.type,
      name: params.name ?? existing.name,
      appId: params.appId === undefined ? existing.appId : params.appId,
      clientId: params.clientId === undefined ? existing.clientId : params.clientId,
      installationId:
        params.installationId === undefined ? existing.installationId : params.installationId,
      clientSecretReferenceId,
      encryptedClientSecret,
      webhookSecretReferenceId,
      encryptedWebhookSecret,
      updatedAt: new Date(),
    })
    .where(eq(gitProvider.id, existing.id));

  await writeAuditLog(
    params.organizationId,
    params.audit,
    "git_provider.updated",
    "git_provider",
    existing.id,
    {
      rotatedClientSecret: params.clientSecret !== undefined,
      rotatedWebhookSecret: params.webhookSecret !== undefined,
    },
  );

  const updated = await db.query.gitProvider.findFirst({
    where: eq(gitProvider.id, existing.id),
  });

  return formatGitProvider(updated!);
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
) {
  const existing = await validateAccess(providerId, organizationId);
  await db.delete(gitProvider).where(eq(gitProvider.id, providerId));

  await writeAuditLog(
    organizationId,
    audit,
    "git_provider.deleted",
    "git_provider",
    existing.id,
    {},
  );

  return { success: true as const };
}

export async function rotateGitProviderSecret(params: {
  organizationId: string;
  providerId: string;
  reason: string;
  clientSecret?: string;
  webhookSecret?: string;
  audit: AuditContext;
}) {
  if (!params.clientSecret && !params.webhookSecret) {
    throw new DomainError("BAD_REQUEST", "Provide clientSecret or webhookSecret to rotate");
  }

  const existing = await validateAccess(params.providerId, params.organizationId);
  let clientSecretReferenceId = existing.clientSecretReferenceId;
  let encryptedClientSecret = existing.encryptedClientSecret;
  let webhookSecretReferenceId = existing.webhookSecretReferenceId;
  let encryptedWebhookSecret = existing.encryptedWebhookSecret;

  if (params.clientSecret) {
    const secret = await upsertSecretReference({
      organizationId: params.organizationId,
      kind: "git_client_secret",
      logicalScope: "organization",
      logicalScopeId: params.organizationId,
      key: `${existing.id}.client_secret`,
      plaintext: params.clientSecret,
      actorUserId: params.audit.userId,
    });
    clientSecretReferenceId = secret.reference.id;
    encryptedClientSecret = encodeLegacySecret(params.clientSecret);
  }

  if (params.webhookSecret) {
    const secret = await upsertSecretReference({
      organizationId: params.organizationId,
      kind: "git_webhook_secret",
      logicalScope: "organization",
      logicalScopeId: params.organizationId,
      key: `${existing.id}.webhook_secret`,
      plaintext: params.webhookSecret,
      actorUserId: params.audit.userId,
    });
    webhookSecretReferenceId = secret.reference.id;
    encryptedWebhookSecret = encodeLegacySecret(params.webhookSecret);
  }

  await db
    .update(gitProvider)
    .set({
      clientSecretReferenceId,
      encryptedClientSecret,
      webhookSecretReferenceId,
      encryptedWebhookSecret,
      updatedAt: new Date(),
    })
    .where(eq(gitProvider.id, existing.id));

  await writeAuditLog(
    params.organizationId,
    params.audit,
    "secret.rotated",
    "git_provider",
    existing.id,
    {
      reason: params.reason,
      rotatedClientSecret: !!params.clientSecret,
      rotatedWebhookSecret: !!params.webhookSecret,
    },
  );

  const updated = await db.query.gitProvider.findFirst({
    where: eq(gitProvider.id, existing.id),
  });

  return formatGitProvider(updated!);
}
