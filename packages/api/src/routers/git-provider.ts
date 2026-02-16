import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { db, eq } from "@otterstack/db";
import { gitProvider } from "@otterstack/db/schema/infrastructure";
import { upsertSecretReference } from "@otterstack/secrets";

import { orgAdminProcedure, orgAdminStepUpProcedure } from "../index";
import { writeAuditLogEvent } from "../utils/audit";
import { createId } from "../utils/helpers";
import { encodeLegacySecret } from "../utils/legacy-secret";
import { validateGitProviderAccess } from "../utils/ownership";

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

export const gitProviderRouter = {
  create: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
        type: z.string().min(1),
        name: z.string().min(1).max(128),
        appId: z.string().optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        installationId: z.string().optional(),
        webhookSecret: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const providerId = createId();
      const now = new Date();

      const clientSecret = input.clientSecret
        ? await upsertSecretReference({
            organizationId: context.organizationId,
            kind: "git_client_secret",
            logicalScope: "organization",
            logicalScopeId: context.organizationId,
            key: `${providerId}.client_secret`,
            plaintext: input.clientSecret,
            actorUserId: context.userId,
          })
        : null;

      const webhookSecret = input.webhookSecret
        ? await upsertSecretReference({
            organizationId: context.organizationId,
            kind: "git_webhook_secret",
            logicalScope: "organization",
            logicalScopeId: context.organizationId,
            key: `${providerId}.webhook_secret`,
            plaintext: input.webhookSecret,
            actorUserId: context.userId,
          })
        : null;

      const row = {
        id: providerId,
        organizationId: context.organizationId,
        type: input.type,
        name: input.name,
        appId: input.appId ?? null,
        clientId: input.clientId ?? null,
        clientSecretReferenceId: clientSecret?.reference.id ?? null,
        encryptedClientSecret: input.clientSecret
          ? encodeLegacySecret(input.clientSecret)
          : null,
        installationId: input.installationId ?? null,
        webhookSecretReferenceId: webhookSecret?.reference.id ?? null,
        encryptedWebhookSecret: input.webhookSecret
          ? encodeLegacySecret(input.webhookSecret)
          : null,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(gitProvider).values(row);

      await writeAuditLogEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "git_provider.created",
        entityType: "git_provider",
        entityId: providerId,
        metadata: {
          hasClientSecret: !!input.clientSecret,
          hasWebhookSecret: !!input.webhookSecret,
        },
        headers: context.headers,
      });

      return formatGitProvider(row as typeof gitProvider.$inferSelect);
    }),

  update: orgAdminProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
        type: z.string().min(1).optional(),
        name: z.string().min(1).max(128).optional(),
        appId: z.string().nullable().optional(),
        clientId: z.string().nullable().optional(),
        clientSecret: z.string().optional(),
        installationId: z.string().nullable().optional(),
        webhookSecret: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const existing = await validateGitProviderAccess(input.providerId, context.organizationId);

      let clientSecretReferenceId = existing.clientSecretReferenceId;
      let encryptedClientSecret = existing.encryptedClientSecret;
      if (input.clientSecret !== undefined) {
        const clientSecret = await upsertSecretReference({
          organizationId: context.organizationId,
          kind: "git_client_secret",
          logicalScope: "organization",
          logicalScopeId: context.organizationId,
          key: `${existing.id}.client_secret`,
          plaintext: input.clientSecret,
          actorUserId: context.userId,
        });
        clientSecretReferenceId = clientSecret.reference.id;
        encryptedClientSecret = encodeLegacySecret(input.clientSecret);
      }

      let webhookSecretReferenceId = existing.webhookSecretReferenceId;
      let encryptedWebhookSecret = existing.encryptedWebhookSecret;
      if (input.webhookSecret !== undefined) {
        const webhookSecret = await upsertSecretReference({
          organizationId: context.organizationId,
          kind: "git_webhook_secret",
          logicalScope: "organization",
          logicalScopeId: context.organizationId,
          key: `${existing.id}.webhook_secret`,
          plaintext: input.webhookSecret,
          actorUserId: context.userId,
        });
        webhookSecretReferenceId = webhookSecret.reference.id;
        encryptedWebhookSecret = encodeLegacySecret(input.webhookSecret);
      }

      await db
        .update(gitProvider)
        .set({
          type: input.type ?? existing.type,
          name: input.name ?? existing.name,
          appId: input.appId === undefined ? existing.appId : input.appId,
          clientId: input.clientId === undefined ? existing.clientId : input.clientId,
          installationId:
            input.installationId === undefined
              ? existing.installationId
              : input.installationId,
          clientSecretReferenceId,
          encryptedClientSecret,
          webhookSecretReferenceId,
          encryptedWebhookSecret,
          updatedAt: new Date(),
        })
        .where(eq(gitProvider.id, existing.id));

      await writeAuditLogEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "git_provider.updated",
        entityType: "git_provider",
        entityId: existing.id,
        metadata: {
          rotatedClientSecret: input.clientSecret !== undefined,
          rotatedWebhookSecret: input.webhookSecret !== undefined,
        },
        headers: context.headers,
      });

      const updated = await db.query.gitProvider.findFirst({
        where: eq(gitProvider.id, existing.id),
      });

      return formatGitProvider(updated!);
    }),

  list: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context }) => {
      const rows = await db.query.gitProvider.findMany({
        where: eq(gitProvider.organizationId, context.organizationId),
      });
      return rows.map(formatGitProvider);
    }),

  delete: orgAdminProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const existing = await validateGitProviderAccess(input.providerId, context.organizationId);
      await db.delete(gitProvider).where(eq(gitProvider.id, input.providerId));

      await writeAuditLogEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "git_provider.deleted",
        entityType: "git_provider",
        entityId: existing.id,
        metadata: {},
        headers: context.headers,
      });

      return { success: true as const };
    }),

  rotateSecret: orgAdminStepUpProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
        reason: z.string().min(1).max(256),
        clientSecret: z.string().optional(),
        webhookSecret: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (!input.clientSecret && !input.webhookSecret) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Provide clientSecret or webhookSecret to rotate",
        });
      }

      const existing = await validateGitProviderAccess(input.providerId, context.organizationId);
      let clientSecretReferenceId = existing.clientSecretReferenceId;
      let encryptedClientSecret = existing.encryptedClientSecret;
      let webhookSecretReferenceId = existing.webhookSecretReferenceId;
      let encryptedWebhookSecret = existing.encryptedWebhookSecret;

      if (input.clientSecret) {
        const secret = await upsertSecretReference({
          organizationId: context.organizationId,
          kind: "git_client_secret",
          logicalScope: "organization",
          logicalScopeId: context.organizationId,
          key: `${existing.id}.client_secret`,
          plaintext: input.clientSecret,
          actorUserId: context.userId,
        });
        clientSecretReferenceId = secret.reference.id;
        encryptedClientSecret = encodeLegacySecret(input.clientSecret);
      }

      if (input.webhookSecret) {
        const secret = await upsertSecretReference({
          organizationId: context.organizationId,
          kind: "git_webhook_secret",
          logicalScope: "organization",
          logicalScopeId: context.organizationId,
          key: `${existing.id}.webhook_secret`,
          plaintext: input.webhookSecret,
          actorUserId: context.userId,
        });
        webhookSecretReferenceId = secret.reference.id;
        encryptedWebhookSecret = encodeLegacySecret(input.webhookSecret);
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

      await writeAuditLogEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "secret.rotated",
        entityType: "git_provider",
        entityId: existing.id,
        metadata: {
          reason: input.reason,
          rotatedClientSecret: !!input.clientSecret,
          rotatedWebhookSecret: !!input.webhookSecret,
        },
        headers: context.headers,
      });

      const updated = await db.query.gitProvider.findFirst({
        where: eq(gitProvider.id, existing.id),
      });

      return formatGitProvider(updated!);
    }),
};
