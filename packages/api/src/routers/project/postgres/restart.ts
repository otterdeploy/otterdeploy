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
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectRef } from "../../scopes";

import { defaultImageFor } from "../../../swarm";
import { getLatestDeploymentForResource } from "../deployments";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "../errors";
import { getDatabaseResourceRecord, getProjectInOrg } from "../queries";
import { mapDatabaseResource, type PostgresResource } from "../views";
import { rollDatabaseContainer } from "./roll";

export async function restartDatabaseResource(
  input: ProjectRef & { resourceId: ResourceId },
  log: RequestLogger,
): Promise<Result<PostgresResource, ProjectNotFoundError | PostgresResourceNotFoundError>> {
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

  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const engine = record.database.engine;
  // Preserve the image that's actually running — the latest deployment row is
  // the source of truth (a pgvector/postgis image can't be re-derived from the
  // engine default). Fall back to the default for a DB with no history.
  const latest = await getLatestDeploymentForResource(input.resourceId);
  const image = latest?.image ?? defaultImageFor(engine);

  // rollDatabaseContainer owns the deployment row + eager status bookkeeping.
  await rollDatabaseContainer({ record, projectSlug: project.slug, image, reason: "restart" }, log);

  return Result.ok(
    await mapDatabaseResource(
      { resource: record.resource, database: record.database },
      project.slug,
    ),
  );
}
