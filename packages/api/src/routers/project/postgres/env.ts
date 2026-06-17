/**
 * Postgres resource mutators: public-toggle, env-var writers, rollback.
 *
 * All paths through `applyPostgresExtraEnv` are the only way the postgres
 * container env array changes after creation — they insert a deployment
 * row, persist the new env, and roll the swarm task. Direct callers
 * (`setPostgresExtraEnvKey`, `unsetPostgresExtraEnvKey`,
 * `rollbackPostgresToSnapshot`) just build the desired env map.
 */

import type { ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { reconcile } from "../../../caddy";
import {
  deleteProxyRoutesByResource,
  insertProxyRoute,
} from "../../../caddy/queries";
import { loadDomainSourcesForProject } from "../../../lib/domain-sources";
import { resolvePublicDomain } from "../../../lib/domains";
import { defaultImageFor } from "../../../swarm";
import { updateSwarmDatabase } from "../../../runtime/db";

import { insertDeployment, markDeploymentFailed } from "../deployments";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "../errors";

import {
  getDatabaseResourceRecord,
  getProjectInOrg,
  setDatabaseResourceExtraEnv,
  setDatabaseResourcePublic,
} from "../queries";
import { snapshotForPostgresCreate, type PostgresSnapshotV1 } from "./snapshot";
import type { ProjectRef } from "../../scopes";
import {
  buildContainerName,
  buildVolumeName,
  mapDatabaseResource,
  sanitizeProjectSlug,
  type PostgresResource,
} from "../views";

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
    // Caddy can only issue a public ACME cert for a domain the operator
    // proved they own — recompute the resolver outcome here so the route
    // carries the right tls flag regardless of when the DB was created.
    const domainSources = (await loadDomainSourcesForProject(
      input.projectId,
    )) ?? {
      resourceOverride: null,
      projectCustomDomain: null,
      projectCustomDomainVerifiedAt: null,
      orgBaseDomain: null,
      orgBaseDomainVerifiedAt: null,
      localBaseDomain: null,
      serverIp: null,
    };
    const resolved = resolvePublicDomain(
      {
        resourceSlug: record.resource.name,
        projectSlug: project.slug,
        kind: "database",
      },
      domainSources,
    );
    await insertProxyRoute({
      projectId: input.projectId,
      resourceId: input.resourceId,
      type: "layer4",
      domain: record.database.publicHostname,
      upstreamHost: record.database.internalHostname,
      upstreamPort: record.database.internalPort,
      protocol: "tcp",
      layer4Alpn: "postgresql",
      // ACME only for resolver-verified domains; sslip + unverified
      // org/project domains stay on `tls internal`.
      usesAcme: resolved.verified && resolved.source !== "sslip-fallback",
    });
  }

  await setDatabaseResourcePublic(input.resourceId, input.publicEnabled);

  // Re-roll the swarm spec so the host port binding follows the flag.
  // When public goes ON we add EndpointSpec.Ports (publishes <port>:5432
  // on the swarm node); when it goes OFF we drop it. App containers in
  // the same project keep reaching the DB through the overlay network
  // alias — that path is independent of host publishing.
  const engine = record.database.engine;
  const engineImage = defaultImageFor(engine);
  const publicDeployment = await insertDeployment({
    resourceId: input.resourceId,
    image: engineImage,
    reason: "redeploy",
    snapshot: snapshotForPostgresCreate({
      image: engineImage,
      databaseName: record.database.databaseName,
      username: record.database.username,
      password: record.database.password,
      publicEnabled: input.publicEnabled,
      publicHostname: record.database.publicHostname,
      internalHostname: record.database.internalHostname,
      extraEnv: record.database.extraEnv ?? {},
    }),
  });
  try {
    await updateSwarmDatabase(
      {
        engine,
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
        resourceId: input.resourceId,
        deploymentId: publicDeployment.id,
        extraEnv: record.database.extraEnv ?? {},
        public: input.publicEnabled,
      },
      log,
    );
  } catch (err) {
    await markDeploymentFailed(
      publicDeployment.id,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }

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
export async function applyPostgresExtraEnv(
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

  // BUG GUARD: read the engine off the DB record and use it for both
  // the deployment image and the swarm update. The legacy
  // `updateSwarmPostgres` hardcoded `engine: "postgres"`, which silently
  // replaced redis/mariadb/mongo containers with postgres on every env
  // change. Always route through `updateSwarmDatabase` with the actual
  // engine from the record.
  const engine = record.database.engine;
  const engineImage = defaultImageFor(engine);

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
  await updateSwarmDatabase(
    {
      engine,
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
async function rollbackPostgresToSnapshot(
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
