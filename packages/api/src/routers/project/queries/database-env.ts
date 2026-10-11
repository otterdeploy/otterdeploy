/**
 * Optimistic concurrency for a database's env set (`databaseResource.extraEnv`),
 * the database half of the stale-save check: a Variables save names the version of the
 * set its editor loaded and is refused when the set changed since.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource } from "@otterdeploy/db/schema/project";
import { envSetVersion } from "@otterdeploy/shared/env-version";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { EnvVersionConflictError } from "../../service/env-version-error";

/** The version of a database's env set as the Variables editor sees it. */
function databaseEnvVersion(
  extraEnv: Record<string, string> | null,
  secretKeys: ReadonlyArray<string> | null,
): string {
  const secret = new Set(secretKeys ?? []);
  return envSetVersion(
    Object.entries(extraEnv ?? {}).map(([key, value]) => ({
      key,
      value,
      isSecret: secret.has(key),
    })),
  );
}

/**
 * setDatabaseResourceExtraEnv, refused with EnvVersionConflictError when the
 * stored set no longer has `expectedVersion`. The row lock makes
 * the check and the write one step against a concurrent save.
 */
export async function setDatabaseResourceExtraEnvAt(
  resourceId: ResourceId,
  extraEnv: Record<string, string>,
  secretKeys: string[] | undefined,
  expectedVersion: string,
): Promise<Result<void, EnvVersionConflictError>> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ extraEnv: databaseResource.extraEnv, secretKeys: databaseResource.secretKeys })
      .from(databaseResource)
      .where(eq(databaseResource.resourceId, resourceId))
      .for("update")
      .$withCache(false);
    const currentVersion = databaseEnvVersion(current?.extraEnv ?? {}, current?.secretKeys ?? []);
    if (currentVersion !== expectedVersion) {
      return Result.err(new EnvVersionConflictError({ expectedVersion, currentVersion }));
    }
    await tx
      .update(databaseResource)
      .set({
        extraEnv,
        ...(secretKeys !== undefined ? { secretKeys } : {}),
        updatedAt: new Date(),
      })
      .where(eq(databaseResource.resourceId, resourceId));
    return Result.ok(undefined);
  });
}
