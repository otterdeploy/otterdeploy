/**
 * Postgres database-resource orchestration. Owns the create/get/list/delete
 * lifecycle for a Postgres resource attached to a project — including the
 * Swarm provision/destroy and Caddy proxy-route bookkeeping.
 */

import { randomBytes } from "node:crypto";

import { Result } from "better-result";
import { eq } from "drizzle-orm";
import type { RequestLogger } from "evlog";

import { db } from "@otterstack/db";
import { resource } from "@otterstack/db/schema/project";

import { reconcile } from "../../caddy";
import {
  deleteProxyRoutesByResource,
  insertProxyRoute,
} from "../../caddy/queries";
import { PLATFORM } from "../../constants";
import { destroySwarmPostgres, provisionSwarmPostgres } from "../../swarm";

import { type ResourceId } from "../service/errors";

import {
  PostgresResourceConflictError,
  PostgresResourceNotFoundError,
  ProjectNotFoundError,
  type ProjectId,
} from "./errors";
import {
  createDatabaseResourceRecord,
  getDatabaseResourceByProjectAndName,
  getDatabaseResourceRecord,
  getProjectInOrg,
  listDatabaseResourceRecords,
  updateDatabaseResourceStatus,
} from "./queries";
import {
  buildConnectionString,
  buildContainerName,
  clampPostgresIdentifier,
  isUniqueViolation,
  mapDatabaseResource,
  sanitizeDatabaseName,
  sanitizeDockerName,
  sanitizeProjectSlug,
  type PostgresResourceView,
} from "./views";

type ProjectRef = {
  projectId: ProjectId;
  organizationId: string;
};

type PostgresResourceRef = ProjectRef & {
  resourceId: ResourceId;
};

export async function createPostgresResource(
  input: ProjectRef & { name: string },
  log: RequestLogger,
): Promise<
  Result<
    PostgresResourceView,
    ProjectNotFoundError | PostgresResourceConflictError
  >
> {
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

  const runtime = await provisionSwarmPostgres({
    serviceName: containerName,
    volumeName,
    hostnameAlias: internalHostname,
    databaseName,
    username,
    password,
    projectSlug,
  });
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

  const reconcileResult = await reconcile();
  const isApplied = reconcileResult.applied.includes(input.projectId);
  log.set({ reconcile: { applied: isApplied } });

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

export async function getPostgresResource(
  input: PostgresResourceRef,
): Promise<Result<PostgresResourceView, PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  return Result.ok(await mapDatabaseResource(record, project.slug));
}

export async function listPostgresResources(
  input: ProjectRef,
): Promise<Result<PostgresResourceView[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const records = await listDatabaseResourceRecords(input.projectId);
  const views = await Promise.all(
    records.map((record) => mapDatabaseResource(record, project.slug)),
  );
  return Result.ok(views);
}

export async function deletePostgresResource(
  input: PostgresResourceRef,
  log: RequestLogger,
): Promise<Result<{ ok: true }, PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    log.set({ resource: { outcome: "resource_not_found" } });
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    log.set({ resource: { outcome: "resource_not_found" } });
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  const projectSlug = sanitizeProjectSlug(project.slug);
  const serviceName = buildContainerName({
    projectSlug,
    resourceName: record.resource.name,
  });

  log.set({
    resource: {
      kind: "postgres",
      projectId: input.projectId,
      name: record.resource.name,
    },
  });

  // 1. Remove proxy route
  await deleteProxyRoutesByResource(input.resourceId);

  // 2. Stop and remove Swarm service
  await destroySwarmPostgres({ serviceName });

  // 3. Delete resource from DB (cascades to database_resource)
  await db.delete(resource).where(eq(resource.id, input.resourceId));

  // 4. Reconcile Caddy to remove the route
  await reconcile();

  log.set({
    teardown: { proxyRoutesRemoved: true, swarmDestroyed: true, dbDeleted: true },
  });

  return Result.ok({ ok: true });
}
