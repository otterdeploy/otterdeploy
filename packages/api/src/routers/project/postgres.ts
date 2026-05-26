/**
 * Postgres database-resource orchestration. Owns the create lifecycle for a
 * Postgres resource attached to a project — including the Swarm provision and
 * Caddy proxy-route bookkeeping. Read/delete are handled generically in
 * resources.ts.
 */

import { randomBytes } from "node:crypto";

import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { reconcile } from "../../caddy";
import {
  deleteProxyRoutesByResource,
  insertProxyRoute,
} from "../../caddy/queries";
import { PLATFORM } from "../../constants";
import { provisionSwarmPostgres, updateSwarmPostgres } from "../../swarm";

import { type Id, ID_PREFIX } from "@otterstack/shared/id";

import {
  PostgresResourceConflictError,
  PostgresResourceNotFoundError,
  ProjectNotFoundError,
  type ProjectId,
} from "./errors";
import type { ResourceId } from "../service/errors";

type OrgId = Id<typeof ID_PREFIX.organization>;
import {
  createDatabaseResourceRecord,
  getDatabaseResourceByProjectAndName,
  getDatabaseResourceRecord,
  getProjectInOrg,
  setDatabaseResourceExtraEnv,
  setDatabaseResourcePublic,
  updateDatabaseResourceStatus,
} from "./queries";
import {
  buildConnectionString,
  buildContainerName,
  buildVolumeName,
  clampPostgresIdentifier,
  isUniqueViolation,
  mapDatabaseResource,
  sanitizeDatabaseName,
  sanitizeDockerName,
  sanitizeProjectSlug,
  type PostgresResource,
} from "./views";

interface ProjectRef {
  projectId: ProjectId;
  organizationId: OrgId;
}

export async function createPostgresResource(
  input: ProjectRef & { name: string; publicEnabled?: boolean },
  log: RequestLogger,
): Promise<
  Result<
    PostgresResource,
    ProjectNotFoundError | PostgresResourceConflictError
  >
> {
  const publicEnabled = input.publicEnabled ?? false;
  log.set({
    resource: { kind: "postgres", projectId: input.projectId, name: input.name },
  });

  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    log.set({ resource: { outcome: "project_not_found" } });
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const existing = await getDatabaseResourceByProjectAndName(
    input.projectId,
    input.name,
  );
  if (existing) {
    log.set({ resource: { outcome: "resource_conflict" } });
    return Result.err(new PostgresResourceConflictError({ name: input.name }));
  }

  const resourceSlug = sanitizeDatabaseName(input.name);
  const projectSlug = sanitizeProjectSlug(project.slug);
  const databaseName = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_db`);
  const username = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_user`);
  const password = randomBytes(18).toString("base64url");
  const publicHostname = `${resourceSlug}-${projectSlug}.${PLATFORM.database.publicBaseDomain}`;
  const containerName = sanitizeDockerName(
    `otterstack-pg-${projectSlug}-${resourceSlug}`,
  );
  const volumeName = sanitizeDockerName(
    `otterstack-pgdata-${projectSlug}-${resourceSlug}`,
  );
  const internalHostname = `${resourceSlug}.${projectSlug}.${PLATFORM.database.internalBaseDomain}`;

  const runtime = await provisionSwarmPostgres(
    {
      serviceName: containerName,
      volumeName,
      hostnameAlias: internalHostname,
      databaseName,
      username,
      password,
      projectSlug,
    },
    log,
  );
  log.set({ provision: { service: containerName, status: runtime.status } });

  const publicConnectionString = buildConnectionString({
    username,
    password,
    hostname: publicHostname,
    databaseName,
    sslmode: "require",
    sslnegotiation: "direct",
  });
  const internalConnectionString = buildConnectionString({
    username,
    password,
    hostname: internalHostname,
    port: PLATFORM.database.internalPort,
    databaseName,
  });

  let created: Awaited<ReturnType<typeof createDatabaseResourceRecord>>;
  try {
    created = await createDatabaseResourceRecord({
      projectId: input.projectId,
      name: input.name,
      status: "draft",
      databaseName,
      username,
      password,
      publicEnabled,
      publicHostname,
      publicPort: PLATFORM.database.publicPort,
      publicConnectionString,
      internalHostname,
      internalPort: PLATFORM.database.internalPort,
      internalConnectionString,
      upstreamHost: internalHostname,
      upstreamPort: PLATFORM.database.internalPort,
      caddyLayer4Snippet: "",
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      log.set({ resource: { outcome: "resource_conflict" } });
      return Result.err(new PostgresResourceConflictError({ name: input.name }));
    }
    throw error;
  }

  // Only register the layer-4 proxy route when the operator explicitly
  // opted in to public exposure. Without this gate, every DB was reachable
  // from the open internet at provision time — wrong default.
  if (publicEnabled) {
    await insertProxyRoute({
      projectId: input.projectId,
      resourceId: created.resource.id,
      type: "layer4",
      domain: publicHostname,
      upstreamHost: internalHostname,
      upstreamPort: PLATFORM.database.internalPort,
      protocol: "tcp",
      layer4Alpn: "postgresql",
    });
  }

  const reconcileResult = await reconcile(log);
  const isApplied = reconcileResult.applied.includes(input.projectId);
  log.set({
    reconcile: { applied: isApplied },
    resource: { publicEnabled },
  });

  await updateDatabaseResourceStatus(
    created.resource.id,
    isApplied ? "valid" : "invalid",
  );

  return Result.ok(
    await mapDatabaseResource(
      {
        ...created,
        resource: {
          ...created.resource,
          status: isApplied ? "valid" : "invalid",
        },
      },
      project.slug,
    ),
  );
}

/**
 * Flip the public-exposure flag on an existing postgres resource. When
 * enabling, registers a layer-4 proxy route to the internal hostname; when
 * disabling, drops every proxy route attached to the resource. Always runs
 * the Caddy reconcile so the running config catches up.
 */
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
  const next = { ...(record.database.extraEnv ?? {}), [input.key]: input.value };
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
  const current = { ...(record.database.extraEnv ?? {}) };
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
