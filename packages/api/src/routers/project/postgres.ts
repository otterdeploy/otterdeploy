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
import { insertProxyRoute } from "../../caddy/queries";
import { PLATFORM } from "../../constants";
import { provisionSwarmPostgres } from "../../swarm";

import { type Id, ID_PREFIX } from "@otterstack/shared/id";

import {
  PostgresResourceConflictError,
  ProjectNotFoundError,
  type ProjectId,
} from "./errors";

type OrgId = Id<typeof ID_PREFIX.organization>;
import {
  createDatabaseResourceRecord,
  getDatabaseResourceByProjectAndName,
  getProjectInOrg,
  updateDatabaseResourceStatus,
} from "./queries";
import {
  buildConnectionString,
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
  input: ProjectRef & { name: string },
  log: RequestLogger,
): Promise<
  Result<
    PostgresResource,
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

  const reconcileResult = await reconcile(log);
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
