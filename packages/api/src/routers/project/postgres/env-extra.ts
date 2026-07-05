/**
 * Postgres `extraEnv` write path + the thin editor wrappers that build the
 * desired env map (set/unset a key, rollback to a snapshot). All mutations
 * funnel through `applyPostgresExtraEnv`, which is the only way the postgres
 * container env array changes after creation — it inserts a deployment row,
 * persists the new env, and rolls the swarm task.
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectRef } from "../../scopes";

import { resolvePostgresImage } from "@otterdeploy/shared/postgres-extensions";

import { updateSwarmDatabase } from "../../../runtime/db";
import { defaultImageFor } from "../../../swarm";
import { insertDeployment, reconcileDeploySuccess } from "../deployments";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "../errors";
import {
  getDatabaseResourceRecord,
  getProjectInOrg,
  setDatabaseResourceExtraEnv,
} from "../queries";
import {
  buildContainerName,
  buildVolumeName,
  mapDatabaseResource,
  sanitizeProjectSlug,
  type PostgresResource,
} from "../views";
import { snapshotForPostgresCreate, type PostgresSnapshotV1 } from "./snapshot";

/**
 * Shared write path for editor mutations on `extraEnv`. Persists the new map,
 * then rolls the swarm service with the merged Env array. The DB user/pass/
 * db rows are derived from the resource record — they're never read from
 * `extraEnv` — so a stale or malicious key in the editor can't displace the
 * database identity.
 */
export async function applyPostgresExtraEnv(
  ref: ProjectRef & { resourceId: ResourceId; nextExtraEnv: Record<string, string> },
  log: RequestLogger,
): Promise<Result<PostgresResource, ProjectNotFoundError | PostgresResourceNotFoundError>> {
  log.set({
    resource: { kind: "postgres", projectId: ref.projectId, id: ref.resourceId },
    extraEnv: { keys: Object.keys(ref.nextExtraEnv) },
  });

  const project = await getProjectInOrg({
    projectId: ref.projectId,
    organizationId: ref.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: ref.projectId }));
  }

  const record = await getDatabaseResourceRecord(ref.projectId, ref.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: ref.resourceId }));
  }

  await setDatabaseResourceExtraEnv(ref.resourceId, ref.nextExtraEnv);

  // BUG GUARD: read the engine off the DB record and use it for both
  // the deployment image and the swarm update. The legacy
  // `updateSwarmPostgres` hardcoded `engine: "postgres"`, which silently
  // replaced redis/mariadb/mongo containers with postgres on every env
  // change. Always route through `updateSwarmDatabase` with the actual
  // engine from the record.
  const engine = record.database.engine;
  // Extension-resolved image, not the bare engine default — an env change on
  // a pgvector/postgis/timescale database must not downgrade its image.
  const resolvedImage = resolvePostgresImage(
    record.database.extensions ?? [],
    defaultImageFor(engine),
  );
  const engineImage = resolvedImage.ok ? resolvedImage.image : defaultImageFor(engine);

  // New deployment for the env change — labels onto the rolled spec so the
  // resulting tasks group under this row in the Deployments tab.
  const envDeployment = await insertDeployment({
    resourceId: ref.resourceId,
    image: engineImage,
    reason: "env-change",
    snapshot: snapshotForPostgresCreate({
      image: engineImage,
      databaseName: record.database.databaseName,
      username: record.database.username,
      password: record.database.password,
      publicEnabled: record.database.publicEnabled,
      publicHostname: record.database.publicHostname,
      internalHostname: record.database.internalHostname,
      extraEnv: ref.nextExtraEnv,
    }),
  });

  // Roll the running task with the new env. Volume + network stay put; only
  // the container env array changes. ~5s of dropped connections.
  const rolled = await updateSwarmDatabase(
    {
      engine,
      image: engineImage,
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
      resourceId: ref.resourceId,
      deploymentId: envDeployment.id,
      extraEnv: ref.nextExtraEnv,
      public: record.database.publicEnabled,
    },
    log,
  );
  // The driver waited for the rolled container — persist the running flip now
  // so the Deployments card agrees with the live runtime badge immediately.
  if (rolled.status === "running") {
    await reconcileDeploySuccess([envDeployment.id], ref.resourceId);
  }

  return Result.ok(
    await mapDatabaseResource(
      {
        resource: record.resource,
        database: { ...record.database, extraEnv: ref.nextExtraEnv },
      },
      project.slug,
    ),
  );
}

export async function setPostgresExtraEnvKey(
  input: ProjectRef & { resourceId: ResourceId; key: string; value: string },
  log: RequestLogger,
) {
  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }
  const next = { ...record.database.extraEnv, [input.key]: input.value };
  return applyPostgresExtraEnv(
    {
      projectId: input.projectId,
      organizationId: input.organizationId,
      resourceId: input.resourceId,
      nextExtraEnv: next,
    },
    log,
  );
}

export async function unsetPostgresExtraEnvKey(
  input: ProjectRef & { resourceId: ResourceId; key: string },
  log: RequestLogger,
) {
  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }
  const current = { ...record.database.extraEnv };
  delete current[input.key];
  return applyPostgresExtraEnv(
    {
      projectId: input.projectId,
      organizationId: input.organizationId,
      resourceId: input.resourceId,
      nextExtraEnv: current,
    },
    log,
  );
}

/**
 * Apply a postgres snapshot to its resource — the rollback primitive.
 * Today's postgres snapshot only records env-shaped data (the rest of
 * the postgres state — credentials, hostnames — is immutable across the
 * resource's lifetime), so rollback is "set extraEnv to the snapshot's
 * value." The result is ONE new deployment row (reason: "redeploy")
 * whose snapshot equals the snapshot we just replayed. If we later let
 * users edit publicEnabled etc., this function fans out the additional
 * setPostgres* calls in the same flow.
 */
export async function rollbackPostgresToSnapshot(
  input: ProjectRef & {
    resourceId: ResourceId;
    snapshot: PostgresSnapshotV1;
  },
  log: RequestLogger,
) {
  return applyPostgresExtraEnv(
    {
      projectId: input.projectId,
      organizationId: input.organizationId,
      resourceId: input.resourceId,
      nextExtraEnv: input.snapshot.extraEnv,
    },
    log,
  );
}
