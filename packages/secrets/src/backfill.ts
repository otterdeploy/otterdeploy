import { and, db, eq, isNotNull, isNull, or } from "@otterdeploy/db";
import { gitProvider, sshKey } from "@otterdeploy/db/schema/infrastructure";
import { environmentVariable } from "@otterdeploy/db/schema/operations";
import { Result } from "better-result";

import { upsertSecretReference } from "./service";

const SYSTEM_ACTOR_USER_ID = process.env.SECRETS_BACKFILL_ACTOR_USER_ID ?? "system";

function decodeLegacySecret(value: string): string {
  return Result.try({
    try: () => Buffer.from(value, "base64").toString("utf-8"),
    catch: () => value,
  }).unwrapOr(value);
}

async function backfillEnvironmentVariables() {
  const rows = await db.query.environmentVariable.findMany({
    where: isNull(environmentVariable.secretReferenceId),
  });

  let processed = 0;
  for (const row of rows) {
    const secret = await upsertSecretReference({
      organizationId: row.organizationId,
      kind: "env_var",
      logicalScope: row.scope,
      logicalScopeId: row.scopeId,
      key: row.key,
      plaintext: decodeLegacySecret(row.encryptedValue),
      actorUserId: SYSTEM_ACTOR_USER_ID,
    });

    await db
      .update(environmentVariable)
      .set({
        secretReferenceId: secret.reference.id,
        updatedAt: new Date(),
      })
      .where(eq(environmentVariable.id, row.id));

    processed += 1;
  }

  return processed;
}

async function backfillSshKeys() {
  const rows = await db.query.sshKey.findMany({
    where: isNull(sshKey.privateKeySecretReferenceId),
  });

  let processed = 0;
  for (const row of rows) {
    const secret = await upsertSecretReference({
      organizationId: row.organizationId,
      kind: "ssh_private_key",
      logicalScope: "organization",
      logicalScopeId: row.organizationId,
      key: `ssh_key.${row.id}.private_key`,
      plaintext: decodeLegacySecret(row.encryptedPrivateKey),
      actorUserId: SYSTEM_ACTOR_USER_ID,
    });

    await db
      .update(sshKey)
      .set({
        privateKeySecretReferenceId: secret.reference.id,
      })
      .where(eq(sshKey.id, row.id));

    processed += 1;
  }

  return processed;
}

async function backfillGitProviders() {
  const rows = await db.query.gitProvider.findMany({
    where: or(
      and(
        isNull(gitProvider.clientSecretReferenceId),
        isNotNull(gitProvider.encryptedClientSecret),
      ),
      and(
        isNull(gitProvider.webhookSecretReferenceId),
        isNotNull(gitProvider.encryptedWebhookSecret),
      ),
    ),
  });

  let processed = 0;
  for (const row of rows) {
    let clientSecretReferenceId = row.clientSecretReferenceId;
    let webhookSecretReferenceId = row.webhookSecretReferenceId;

    if (!clientSecretReferenceId && row.encryptedClientSecret) {
      const clientSecret = await upsertSecretReference({
        organizationId: row.organizationId,
        kind: "git_client_secret",
        logicalScope: "organization",
        logicalScopeId: row.organizationId,
        key: `${row.id}.client_secret`,
        plaintext: decodeLegacySecret(row.encryptedClientSecret),
        actorUserId: SYSTEM_ACTOR_USER_ID,
      });
      clientSecretReferenceId = clientSecret.reference.id;
    }

    if (!webhookSecretReferenceId && row.encryptedWebhookSecret) {
      const webhookSecret = await upsertSecretReference({
        organizationId: row.organizationId,
        kind: "git_webhook_secret",
        logicalScope: "organization",
        logicalScopeId: row.organizationId,
        key: `${row.id}.webhook_secret`,
        plaintext: decodeLegacySecret(row.encryptedWebhookSecret),
        actorUserId: SYSTEM_ACTOR_USER_ID,
      });
      webhookSecretReferenceId = webhookSecret.reference.id;
    }

    await db
      .update(gitProvider)
      .set({
        clientSecretReferenceId,
        webhookSecretReferenceId,
        updatedAt: new Date(),
      })
      .where(eq(gitProvider.id, row.id));

    processed += 1;
  }

  return processed;
}

async function main() {
  // Run sequentially to avoid cross-table provider-binding races per organization.
  const envVarCount = await backfillEnvironmentVariables();
  const sshCount = await backfillSshKeys();
  const gitCount = await backfillGitProviders();

  console.log(
    JSON.stringify(
      {
        ok: true,
        actorUserId: SYSTEM_ACTOR_USER_ID,
        processed: {
          environmentVariables: envVarCount,
          sshKeys: sshCount,
          gitProviders: gitCount,
        },
      },
      null,
      2,
    ),
  );
}

await main();
