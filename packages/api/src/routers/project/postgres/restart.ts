/**
 * Restart (re-roll) a database resource.
 *
 * Inserts a `restart` deployment and forces swarm to schedule a fresh task
 * with the *current* spec — same image, env, and public flag — rather than the
 * engine default. Preserving the running image matters: extension-bundled
 * images (pgvector / postgis / timescaledb) aren't derivable from
 * `defaultImageFor`, so we read the image off the latest deployment row.
 *
 * This is also the path that re-applies container labels to an existing DB:
 * `updateSwarmDatabase` rebuilds the spec (now carrying the metrics
 * `otterdeploy.resource.id` label) and rolls it, so a database created before
 * a label change starts emitting metrics after one restart.
 */

import type { ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { defaultImageFor, updateSwarmDatabase } from "../../../swarm";

import {
  getLatestDeploymentForResource,
  insertDeployment,
  markDeploymentFailed,
} from "../deployments";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "../errors";
import { getDatabaseResourceRecord, getProjectInOrg } from "../queries";
import type { ProjectRef } from "../../scopes";
import { snapshotForPostgresCreate } from "./snapshot";
import {
  buildContainerName,
  buildVolumeName,
  mapDatabaseResource,
  sanitizeProjectSlug,
  type PostgresResource,
} from "../views";

export async function restartDatabaseResource(
  input: ProjectRef & { resourceId: ResourceId },
  log: RequestLogger,
): Promise<
  Result<PostgresResource, ProjectNotFoundError | PostgresResourceNotFoundError>
> {
  log.set({
    resource: {
      kind: "database",
      projectId: input.projectId,
      id: input.resourceId,
    },
    restart: { requested: true },
  });

  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const record = await getDatabaseResourceRecord(
    input.projectId,
    input.resourceId,
  );
  if (!record) {
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  const engine = record.database.engine;
  // Preserve the image that's actually running — the latest deployment row is
  // the source of truth (a pgvector/postgis image can't be re-derived from the
  // engine default). Fall back to the default for a DB with no history.
  const latest = await getLatestDeploymentForResource(input.resourceId);
  const image = latest?.image ?? defaultImageFor(engine);

  const restartDeployment = await insertDeployment({
    resourceId: input.resourceId,
    image,
    reason: "restart",
    snapshot: snapshotForPostgresCreate({
      image,
      databaseName: record.database.databaseName,
      username: record.database.username,
      password: record.database.password,
      publicEnabled: record.database.publicEnabled,
      publicHostname: record.database.publicHostname,
      internalHostname: record.database.internalHostname,
      extraEnv: record.database.extraEnv ?? {},
      extensions: record.database.extensions ?? undefined,
    }),
  });

  try {
    await updateSwarmDatabase(
      {
        engine,
        resourceId: input.resourceId,
        image,
        serviceName: buildContainerName({
          engine,
          projectSlug: project.slug,
          resourceName: record.resource.name,
        }),
        volumeName: buildVolumeName({
          engine,
          projectSlug: project.slug,
          resourceName: record.resource.name,
        }),
        hostnameAlias: record.database.internalHostname,
        databaseName: record.database.databaseName,
        username: record.database.username,
        password: record.database.password,
        projectSlug: sanitizeProjectSlug(project.slug),
        deploymentId: restartDeployment.id,
        extraEnv: record.database.extraEnv ?? {},
        public: record.database.publicEnabled,
      },
      log,
    );
  } catch (err) {
    await markDeploymentFailed(
      restartDeployment.id,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }

  return Result.ok(
    await mapDatabaseResource(
      { resource: record.resource, database: record.database },
      project.slug,
    ),
  );
}
