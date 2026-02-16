import { db, eq, and, or } from "@otterstack/db";
import { environmentVariable } from "@otterstack/db/schema/operations";
import { deploymentSecretSnapshot } from "@otterstack/db/schema/secrets";
import { revealSecretByReference } from "@otterstack/secrets";

import { decodeLegacySecret, hashSecretDigest } from "./legacy-secret";

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
        and(
          eq(environmentVariable.scope, "project"),
          eq(environmentVariable.scopeId, input.projectId),
        ),
        and(
          eq(environmentVariable.scope, "environment"),
          eq(environmentVariable.scopeId, input.environmentId),
        ),
        and(
          eq(environmentVariable.scope, "resource"),
          eq(environmentVariable.scopeId, input.resourceId),
        ),
      ),
    ),
  });

  const scopeWeight = {
    project: 0,
    environment: 1,
    resource: 2,
  } as const;

  const latestByKey = new Map<string, typeof environmentVariable.$inferSelect>();
  const sortedRows = rows.sort((left, right) => {
    const weightDelta = scopeWeight[left.scope] - scopeWeight[right.scope];
    if (weightDelta !== 0) return weightDelta;
    return left.updatedAt.getTime() - right.updatedAt.getTime();
  });

  for (const row of sortedRows) {
    latestByKey.set(row.key, row);
  }

  const entries = [] as Array<{
    key: string;
    variableId: string;
    scope: "project" | "environment" | "resource";
    secretReferenceId: string | null;
    providerVersion: string | null;
    digest: string;
  }>;

  for (const row of latestByKey.values()) {
    let secretValue = decodeLegacySecret(row.encryptedValue);
    let providerVersion: string | null = null;

    if (row.secretReferenceId) {
      const revealed = await revealSecretByReference({
        organizationId: input.organizationId,
        secretReferenceId: row.secretReferenceId,
        expectedKind: "env_var",
      });
      secretValue = revealed.value;
      providerVersion = revealed.providerVersion;
    }

    entries.push({
      key: row.key,
      variableId: row.id,
      scope: row.scope,
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
    id: crypto.randomUUID(),
    deploymentId: input.deploymentId,
    organizationId: input.organizationId,
    resourceId: input.resourceId,
    entriesJson: entries,
    snapshotHash,
    createdAt: new Date(),
  });
}
