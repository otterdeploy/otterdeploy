import { db, eq, and, or } from "@otterdeploy/db";
import { environmentVariable } from "@otterdeploy/db/schema/operations";
import { deploymentSecretSnapshot } from "@otterdeploy/db/schema/secrets";
import { revealSecretByReference } from "@otterdeploy/secrets";
import { createLogger } from "@otterdeploy/logger";

import { createId } from "@otterdeploy/utils";

import { decodeLegacySecret, hashSecretDigest } from "./legacy-secret";

const log = createLogger("domain:deployment-secret");

export async function createDeploymentSecretSnapshot(input: {
  deploymentId: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  resourceId: string;
}) {
  const rows = await db.query.environmentVariable.findMany({
    where: and(
      eq(environmentVariable.organizationId, input.organizationId),
      or(
        eq(environmentVariable.projectId, input.projectId),
        eq(environmentVariable.environmentId, input.environmentId),
        eq(environmentVariable.resourceId, input.resourceId),
      ),
    ),
  });

  function scopeWeight(row: typeof environmentVariable.$inferSelect): number {
    if (row.resourceId) return 2;
    if (row.environmentId) return 1;
    return 0;
  }

  const latestByKey = new Map<string, typeof environmentVariable.$inferSelect>();
  const sortedRows = rows.sort((left, right) => {
    const weightDelta = scopeWeight(left) - scopeWeight(right);
    if (weightDelta !== 0) return weightDelta;
    return left.updatedAt.getTime() - right.updatedAt.getTime();
  });

  for (const row of sortedRows) {
    latestByKey.set(row.key, row);
  }

  const entries = [] as Array<{
    key: string;
    variableId: string;
    secretReferenceId: string | null;
    providerVersion: string | null;
    digest: string;
  }>;

  for (const row of latestByKey.values()) {
    let secretValue = decodeLegacySecret(row.encryptedValue);
    let providerVersion: string | null = null;

    if (row.secretReferenceId) {
      try {
        const revealed = await revealSecretByReference({
          organizationId: input.organizationId,
          secretReferenceId: row.secretReferenceId,
          expectedKind: "env_var",
        });
        secretValue = revealed.value;
        providerVersion = revealed.providerVersion;
      } catch (error) {
        log.warn(
          {
            deploymentId: input.deploymentId,
            variableId: row.id,
            secretReferenceId: row.secretReferenceId,
            err: error,
          },
          "Failed to resolve secret reference, using legacy encrypted value fallback",
        );
      }
    }

    entries.push({
      key: row.key,
      variableId: row.id,
      secretReferenceId: row.secretReferenceId ?? null,
      providerVersion,
      digest: hashSecretDigest(secretValue),
    });
  }

  const snapshotHash = hashSecretDigest(
    JSON.stringify(
      [...entries].sort((left, right) => left.key.localeCompare(right.key)),
    ),
  );

  await db.insert(deploymentSecretSnapshot).values({
    id: createId(),
    deploymentId: input.deploymentId,
    organizationId: input.organizationId,
    resourceId: input.resourceId,
    entriesJson: entries,
    snapshotHash,
    createdAt: new Date(),
  });
}
