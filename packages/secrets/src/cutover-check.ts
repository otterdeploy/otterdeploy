import { db, isNull, sql } from "@otterdeploy/db";
import { environmentVariable } from "@otterdeploy/db/schema/operations";

async function countEnvironmentVariablesMissingReference() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(environmentVariable)
    .where(isNull(environmentVariable.secretReferenceId));
  return row?.count ?? 0;
}

async function main() {
  const envVarMissing = await countEnvironmentVariablesMissingReference();

  const result = {
    environmentVariablesMissingReference: envVarMissing,
  };

  const hasFailures = Object.values(result).some((count) => count > 0);
  console.log(JSON.stringify({ ok: !hasFailures, checks: result }, null, 2));

  if (hasFailures) {
    process.exit(1);
  }
}

await main();
