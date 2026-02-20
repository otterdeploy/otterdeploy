import { and, db, isNotNull, isNull, sql } from "@otterdeploy/db";
import { gitProvider, sshKey } from "@otterdeploy/db/schema/infrastructure";
import { environmentVariable } from "@otterdeploy/db/schema/operations";

async function countEnvironmentVariablesMissingReference() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(environmentVariable)
    .where(isNull(environmentVariable.secretReferenceId));
  return row?.count ?? 0;
}

async function countSshKeysMissingReference() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sshKey)
    .where(isNull(sshKey.privateKeySecretReferenceId));
  return row?.count ?? 0;
}

async function countGitProvidersMissingClientSecretReference() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gitProvider)
    .where(
      and(
        isNotNull(gitProvider.encryptedClientSecret),
        isNull(gitProvider.clientSecretReferenceId),
      ),
    );
  return row?.count ?? 0;
}

async function countGitProvidersMissingWebhookSecretReference() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gitProvider)
    .where(
      and(
        isNotNull(gitProvider.encryptedWebhookSecret),
        isNull(gitProvider.webhookSecretReferenceId),
      ),
    );
  return row?.count ?? 0;
}

async function main() {
  const [
    envVarMissing,
    sshMissing,
    gitClientMissing,
    gitWebhookMissing,
  ] = await Promise.all([
    countEnvironmentVariablesMissingReference(),
    countSshKeysMissingReference(),
    countGitProvidersMissingClientSecretReference(),
    countGitProvidersMissingWebhookSecretReference(),
  ]);

  const result = {
    environmentVariablesMissingReference: envVarMissing,
    sshKeysMissingReference: sshMissing,
    gitProvidersMissingClientSecretReference: gitClientMissing,
    gitProvidersMissingWebhookSecretReference: gitWebhookMissing,
  };

  const hasFailures = Object.values(result).some((count) => count > 0);
  console.log(JSON.stringify({ ok: !hasFailures, checks: result }, null, 2));

  if (hasFailures) {
    process.exit(1);
  }
}

await main();
