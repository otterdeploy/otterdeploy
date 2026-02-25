import { db, eq, isNull } from "@otterdeploy/db";
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

/** Derive logical scope from the new FK columns. */
function deriveScope(row: {
  projectId: string | null;
  environmentId: string | null;
  resourceId: string | null;
}): { logicalScope: "resource" | "project" | "environment" | "organization"; logicalScopeId: string } {
  if (row.resourceId) return { logicalScope: "resource", logicalScopeId: row.resourceId };
  if (row.environmentId) return { logicalScope: "environment", logicalScopeId: row.environmentId };
  if (row.projectId) return { logicalScope: "project", logicalScopeId: row.projectId };
  throw new Error("environmentVariable row has no scope FK set");
}

async function backfillEnvironmentVariables() {
  const rows = await db.query.environmentVariable.findMany({
    where: isNull(environmentVariable.secretReferenceId),
  });

  let processed = 0;
  for (const row of rows) {
    const { logicalScope, logicalScopeId } = deriveScope(row);

    const secret = await upsertSecretReference({
      organizationId: row.organizationId,
      kind: "env_var",
      logicalScope,
      logicalScopeId,
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

async function main() {
  const envVarCount = await backfillEnvironmentVariables();

  console.log(
    JSON.stringify(
      {
        ok: true,
        actorUserId: SYSTEM_ACTOR_USER_ID,
        processed: {
          environmentVariables: envVarCount,
        },
      },
      null,
      2,
    ),
  );
}

await main();
