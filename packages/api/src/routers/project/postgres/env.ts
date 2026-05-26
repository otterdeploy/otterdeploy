/**
 * Postgres resource mutators: public-toggle, env-var writers, rollback.
 *
 * All paths through `applyPostgresExtraEnv` are the only way the postgres
 * container env array changes after creation — they insert a deployment
 * row, persist the new env, and roll the swarm task. Direct callers
 * (`setPostgresExtraEnvKey`, `unsetPostgresExtraEnvKey`,
 * `rollbackPostgresToSnapshot`) just build the desired env map.
 */

import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { reconcile } from "../../../caddy";
import {
  deleteProxyRoutesByResource,
  insertProxyRoute,
} from "../../../caddy/queries";
import { PLATFORM } from "../../../constants";
import { updateSwarmPostgres } from "../../../swarm";

import { type Id, ID_PREFIX } from "@otterstack/shared/id";

import { insertDeployment } from "../deployments";
import {
  PostgresResourceNotFoundError,
  ProjectNotFoundError,
  type ProjectId,
} from "../errors";
import type { ResourceId } from "../../service/errors";
import {
  getDatabaseResourceRecord,
  getProjectInOrg,
  setDatabaseResourceExtraEnv,
  setDatabaseResourcePublic,
} from "../queries";
import { snapshotForPostgresCreate, type PostgresSnapshotV1 } from "./snapshot";
import {
  buildContainerName,
  buildVolumeName,
  mapDatabaseResource,
  sanitizeProjectSlug,
  type PostgresResource,
} from "../views";

type OrgId = Id<typeof ID_PREFIX.organization>;

interface ProjectRef {
  projectId: ProjectId;
  organizationId: OrgId;
}

export async function setPostgresPublic(
  input: ProjectRef & { resourceId: ResourceId; publicEnabled: boolean },
  log: RequestLogger,
): Promise<
  Result<PostgresResource, ProjectNotFoundError | PostgresResourceNotFoundError>
> {
  log.set({
    resource: { kind: "postgres", projectId: input.projectId, id: input.resourceId },
    setPublic: { requested: input.publicEnabled },
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
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  // Drop existing routes either way — on disable we want them gone; on
  // enable we want exactly one fresh route so a stale registration doesn't
  // sneak through. The reconcile below picks up the new state.
  await deleteProxyRoutesByResource(input.resourceId);

  if (input.publicEnabled) {
    await insertProxyRoute({
      projectId: input.projectId,
      resourceId: input.resourceId,
      type: "layer4",
      domain: record.database.publicHostname,
      upstreamHost: record.database.internalHostname,
      upstreamPort: record.database.internalPort,
      protocol: "tcp",
      layer4Alpn: "postgresql",
    });
  }

  await setDatabaseResourcePublic(input.resourceId, input.publicEnabled);
  await reconcile(log);

  return Result.ok(
    await mapDatabaseResource(
      {
        resource: record.resource,
        database: { ...record.database, publicEnabled: input.publicEnabled },
      },
      project.slug,
    ),
  );
}

/**
 * Shared write path for editor mutations on `extraEnv`. Persists the new map,
 * then rolls the swarm service with the merged Env array. The DB user/pass/
 * db rows are derived from the resource record — they're never read from
 * `extraEnv` — so a stale or malicious key in the editor can't displace the
 * database identity.
 */
async function applyPostgresExtraEnv(
  ref: ProjectRef & { resourceId: ResourceId; nextExtraEnv: Record<string, string> },
  log: RequestLogger,
): Promise<
  Result<PostgresResource, ProjectNotFoundError | PostgresResourceNotFoundError>
> {
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
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: ref.resourceId }),
    );
  }

  await setDatabaseResourceExtraEnv(ref.resourceId, ref.nextExtraEnv);

  // New deployment for the env change — labels onto the rolled spec so the
  // resulting tasks group under this row in the Deployments tab.
  const envDeployment = await insertDeployment({
    resourceId: ref.resourceId,
    image: PLATFORM.docker.postgresImage,
    reason: "env-change",
    snapshot: snapshotForPostgresCreate({
      image: PLATFORM.docker.postgresImage,
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
  await updateSwarmPostgres(
    {
      serviceName: buildContainerName({
        projectSlug: project.slug,
        resourceName: record.resource.name,
      }),
      volumeName: buildVolumeName({
        projectSlug: project.slug,
        resourceName: record.resource.name,
      }),
      hostnameAlias: record.database.internalHostname,
      databaseName: record.database.databaseName,
      username: record.database.username,
      password: record.database.password,
      projectSlug: sanitizeProjectSlug(project.slug),
      deploymentId: envDeployment.id,
      extraEnv: ref.nextExtraEnv,
    },
    log,
  );

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
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
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
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
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
