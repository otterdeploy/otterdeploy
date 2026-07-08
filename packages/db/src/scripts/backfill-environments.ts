/**
 * One-off data backfill for the environment model. Stamps each project's
 * persistent environment onto `service_env_var` rows that pre-date env
 * scoping, so `service_env_var.environment_id` stops being NULL. Deployments
 * are no longer environment-scoped (previews own `deployment.preview_id`),
 * so only the env-var backfill remains.
 *
 * Idempotent: only touches NULL rows, so it's safe to run repeatedly and safe
 * to run before or after `bun db:push`. Run it AFTER the schema push:
 *
 *   bun --filter @otterdeploy/db db:backfill-environments
 *
 * The variable resolver already treats NULL-env rows as a universal fallback,
 * so production keeps working whether or not this has run — this is cleanup
 * that makes the data honest ahead of tightening the columns to NOT NULL.
 */
import { db } from "@otterdeploy/db";
import { sql } from "drizzle-orm";

function rowCount(result: unknown): number {
  return Array.isArray(result) ? result.length : 0;
}

async function main(): Promise<void> {
  // service_env_var.service_resource_id === resource.id (the service_resource
  // sidecar shares the resource PK), so we can join straight to resource.
  const envVars = await db.execute(sql`
    UPDATE service_env_var AS sev
    SET environment_id = p.environment_id
    FROM resource r
    JOIN project p ON p.id = r.project_id
    WHERE sev.service_resource_id = r.id
      AND sev.environment_id IS NULL
      AND p.environment_id IS NOT NULL
    RETURNING sev.id
  `);

  console.log(`[backfill-environments] service_env_var rows updated: ${rowCount(envVars)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[backfill-environments] failed:", err);
    process.exit(1);
  });
