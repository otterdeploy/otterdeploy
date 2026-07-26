/**
 * Rolling a database container onto newly-written env.
 *
 * Split out of `resource-runtime.ts`: everything there is persistence, this is
 * the one step that touches the runtime, and it carries all the "don't silently
 * swap the running image/engine" history worth keeping in one place.
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import { updateSwarmDatabase } from "../../runtime/db";
import { defaultImageFor } from "../../swarm";
import {
  getLatestDeploymentForResource,
  insertDeployment,
  markDeploymentFailed,
} from "./deployments";
import { getDatabaseResourceRecord } from "./queries";
import { buildContainerName, buildVolumeName } from "./views";

export type DatabaseResourceRecord = NonNullable<
  Awaited<ReturnType<typeof getDatabaseResourceRecord>>
>;

/**
 * Re-render a database's swarm spec so its container picks the new env up on
 * its next start.
 */
export async function rollDatabaseEnv(args: {
  resourceId: ResourceId;
  dbRecord: DatabaseResourceRecord;
  projectSlug: string;
  next: Record<string, string>;
  log: RequestLogger;
}): Promise<void> {
  const { resourceId, dbRecord, projectSlug, next, log } = args;
  const resourceName = dbRecord.resource.name;
  // Use the engine from the row — not "postgres" — so redis/mariadb/mongo
  // containers don't get silently replaced with postgres on every env edit.
  // Same bug pattern as env.ts; see the comment there for the full incident.
  const engine = dbRecord.database.engine;
  // Preserve the image that's actually running (latest deployment row) —
  // falling back to the catalog default rolled a version-pinned or
  // extension-bundled database onto the default tag on every env edit.
  const latest = await getLatestDeploymentForResource(resourceId);
  const engineImage = latest?.image ?? defaultImageFor(engine);

  const envDeployment = await insertDeployment({
    resourceId,
    image: engineImage,
    reason: "env-change",
    snapshot: {
      kind: "postgres",
      version: 1,
      image: engineImage,
      databaseName: dbRecord.database.databaseName,
      username: dbRecord.database.username,
      password: dbRecord.database.password,
      publicEnabled: dbRecord.database.publicEnabled,
      publicHostname: dbRecord.database.publicHostname,
      internalHostname: dbRecord.database.internalHostname,
      extraEnv: next,
    },
  });

  // Wrapped so a driver throw marks the just-inserted row failed instead of
  // stranding it "building" forever (the stale-row rescue only covers
  // zero-task rows; a live DB container keeps deriving from its tasks).
  const rolled = await Result.tryPromise({
    try: () =>
      updateSwarmDatabase(
        {
          engine,
          resourceId,
          // Without an explicit image the driver falls back to the engine
          // default — which would swap the running version on an env roll.
          image: engineImage,
          serviceName: buildContainerName({ engine, projectSlug, resourceName }),
          volumeName: buildVolumeName({ engine, projectSlug, resourceName }),
          hostnameAlias: dbRecord.database.internalHostname,
          databaseName: dbRecord.database.databaseName,
          username: dbRecord.database.username,
          password: dbRecord.database.password,
          projectSlug,
          deploymentId: envDeployment.id,
          extraEnv: next,
          public: dbRecord.database.publicEnabled,
        },
        log,
      ),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

  if (rolled.isErr()) {
    await markDeploymentFailed(
      envDeployment.id,
      `database env roll failed: ${rolled.error.message}`,
    ).catch(() => undefined);
    throw rolled.error;
  }
}
