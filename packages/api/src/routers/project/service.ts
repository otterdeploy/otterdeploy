import { randomBytes } from "node:crypto";

import { reconcile } from "../../caddy";
import {
  insertProxyRoute,
  getProxyRouteByResourceId,
  updateProxyRoute,
  deleteProxyRoutesByResource,
  listProxyRoutesByProject,
} from "../../caddy/queries";
import {
  destroyDockerPostgres,
  inspectDockerPostgresRuntime,
  provisionDockerPostgres,
  type DockerPostgresRuntime,
} from "../../docker/postgres";
import { createProjectRecord, db, getProjectById, getProjectBySlug, listProjectRecords } from "@otterstack/db";
import { resource } from "@otterstack/db/schema/project";
import { eq } from "drizzle-orm";
import {
  createDatabaseResourceRecord,
  type DatabaseResourceRecord,
  getDatabaseResourceByProjectAndName,
  getDatabaseResourceRecord,
  getProjectRecord,
  listDatabaseResourceRecords,
  updateDatabaseResourceRuntime,
  updateDatabaseResourceStatus,
} from "@otterstack/db/project-resource";
import { env } from "@otterstack/env/server";

function sanitizeProjectSlug(projectId: string): string {
  const value = projectId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value.length > 0 ? value : "project";
}

type ProjectView = {
  id: string;
  name: string;
  slug: string;
  environmentId: string;
  createdAt: string;
  updatedAt: string;
};

type CreateProjectResult =
  | { ok: true; project: ProjectView }
  | { ok: false; reason: "project_conflict" };

type GetProjectResult =
  | { ok: true; project: ProjectView }
  | { ok: false; reason: "project_not_found" };

type CreatePostgresResourceResult =
  | { ok: true; resource: PostgresResourceView }
  | { ok: false; reason: "project_not_found" | "resource_conflict" };

type GetPostgresResourceResult =
  | { ok: true; resource: PostgresResourceView }
  | { ok: false; reason: "resource_not_found" };

type ListPostgresResourcesResult =
  | { ok: true; resources: PostgresResourceView[] }
  | { ok: false; reason: "project_not_found" };

type DeletePostgresResourceResult =
  | { ok: true }
  | { ok: false; reason: "resource_not_found" };

export type PostgresResourceView = {
  resourceId: string;
  projectId: string;
  name: string;
  type: "database";
  status: "draft" | "valid" | "invalid";
  engine: "postgres";
  databaseName: string;
  username: string;
  password: string;
  publicHostname: string;
  publicPort: number;
  publicConnectionString: string;
  internalHostname: string;
  internalPort: number;
  internalConnectionString: string;
  localConnectionString: string | null;
  upstreamHost: string;
  upstreamPort: number;
  runtime: DockerPostgresRuntime;
};

export type ProxyRouteView = {
  id: string;
  projectId: string;
  resourceId: string | null;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type ListProxyRoutesResult =
  | { ok: true; routes: ProxyRouteView[] }
  | { ok: false; reason: "project_not_found" };

export async function listProjects(): Promise<ProjectView[]> {
  const records = await listProjectRecords();
  return records.map((record) => mapProject(record));
}

export async function getProject(input: { id: string }): Promise<GetProjectResult> {
  const record = await getProjectById(input.id);
  if (!record) {
    return { ok: false, reason: "project_not_found" };
  }

  return {
    ok: true,
    project: mapProject(record),
  };
}

export async function createProject(input: {
  name: string;
  slug: string;
}): Promise<CreateProjectResult> {
  const slug = sanitizeProjectSlug(input.slug);
  const existing = await getProjectBySlug(slug);

  if (existing) {
    return { ok: false, reason: "project_conflict" };
  }

  try {
    const created = await createProjectRecord({
      name: input.name.trim(),
      slug,
    });

    return {
      ok: true,
      project: mapProject(created.project),
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "project_conflict" };
    }

    throw error;
  }
}

export async function createPostgresResource(input: {
  projectId: string;
  name: string;
}): Promise<CreatePostgresResourceResult> {
  console.log("[project:postgres] received request: projectId=%s name=%s", input.projectId, input.name);

  const project = await getProjectRecord(input.projectId);
  console.log("[project:postgres] getProjectRecord done: found=%s", !!project);
  if (!project) {
    return { ok: false, reason: "project_not_found" };
  }

  const existing = await getDatabaseResourceByProjectAndName(input.projectId, input.name);
  console.log("[project:postgres] duplicate check done: exists=%s", !!existing);
  if (existing) {
    return { ok: false, reason: "resource_conflict" };
  }

  console.log("[project:postgres] creating postgres resource '%s' for project %s", input.name, input.projectId);

  const resourceSlug = sanitizeDatabaseName(input.name);
  const projectSlug = sanitizeProjectSlug(project.slug);
  const databaseName = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_db`);
  const username = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_user`);
  const password = randomBytes(18).toString("base64url");
  const publicHostname = `${resourceSlug}-${projectSlug}.${env.DATABASE_PUBLIC_BASE_DOMAIN}`;
  const containerName = sanitizeDockerName(`otterstack-pg-${projectSlug}-${resourceSlug}`);
  const volumeName = sanitizeDockerName(`otterstack-pgdata-${projectSlug}-${resourceSlug}`);
  const internalHostname = `${resourceSlug}.${projectSlug}.${env.DATABASE_INTERNAL_BASE_DOMAIN}`;
  console.log("[project:postgres] provisioning docker container '%s'", containerName);
  const runtime = await provisionDockerPostgres({
    containerName,
    volumeName,
    hostnameAlias: internalHostname,
    databaseName,
    username,
    password,
  });
  console.log("[project:postgres] container '%s' status=%s hostPort=%s", containerName, runtime.status, runtime.hostPort);
  if (runtime.hostPort === null) {
    throw new Error(`Docker runtime for "${containerName}" did not expose a host port.`);
  }
  const publicConnectionString = buildConnectionString({
    username,
    password,
    hostname: publicHostname,
    port: env.DATABASE_PUBLIC_PORT,
    databaseName,
    sslmode: "require",
  });
  const internalConnectionString = buildConnectionString({
    username,
    password,
    hostname: internalHostname,
    port: env.DATABASE_INTERNAL_PORT,
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
      publicPort: env.DATABASE_PUBLIC_PORT,
      publicConnectionString,
      internalHostname,
      internalPort: env.DATABASE_INTERNAL_PORT,
      internalConnectionString,
      upstreamHost: internalHostname,
      upstreamPort: env.DATABASE_INTERNAL_PORT,
      caddyLayer4Snippet: "",
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "resource_conflict" };
    }
    throw error;
  }

  console.log("[project:postgres] inserting proxy route for domain '%s'", publicHostname);
  await insertProxyRoute({
    projectId: input.projectId,
    resourceId: created.resource.id,
    type: "layer4",
    domain: publicHostname,
    upstreamHost: internalHostname,
    upstreamPort: env.DATABASE_INTERNAL_PORT,
    protocol: "tcp",
    layer4Alpn: "postgresql",
  });

  console.log("[project:postgres] running caddy reconciliation");
  const reconcileResult = await reconcile();
  const isApplied = reconcileResult.applied.includes(input.projectId);
  console.log("[project:postgres] reconcile done: applied=%s, resource status=%s", isApplied, isApplied ? "valid" : "invalid");

  await updateDatabaseResourceStatus(created.resource.id, isApplied ? "valid" : "invalid");

  return {
    ok: true,
    resource: await mapDatabaseResource({
      ...created,
      resource: {
        ...created.resource,
        status: isApplied ? "valid" : "invalid",
      },
    }, project.slug),
  };
}

export async function getPostgresResource(input: {
  projectId: string;
  resourceId: string;
}): Promise<GetPostgresResourceResult> {
  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return { ok: false, reason: "resource_not_found" };
  }

  return {
    ok: true,
    resource: await mapDatabaseResource(record),
  };
}

export async function listPostgresResources(input: {
  projectId: string;
}): Promise<ListPostgresResourcesResult> {
  const project = await getProjectRecord(input.projectId);
  if (!project) {
    return { ok: false, reason: "project_not_found" };
  }

  const records = await listDatabaseResourceRecords(input.projectId);

  return {
    ok: true,
    resources: await Promise.all(records.map((record) => mapDatabaseResource(record, project.slug))),
  };
}

export async function deletePostgresResource(input: {
  projectId: string;
  resourceId: string;
}): Promise<DeletePostgresResourceResult> {
  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return { ok: false, reason: "resource_not_found" };
  }

  const project = await getProjectRecord(input.projectId);
  const projectSlug = project ? sanitizeProjectSlug(project.slug) : input.projectId;

  console.log("[project:postgres] deleting resource '%s' (container=%s)", record.resource.name, buildContainerName({ projectSlug, resourceName: record.resource.name }));

  // 1. Remove proxy route
  await deleteProxyRoutesByResource(input.resourceId);
  console.log("[project:postgres] proxy routes removed");

  // 2. Stop and remove Docker container
  const containerName = buildContainerName({ projectSlug, resourceName: record.resource.name });
  await destroyDockerPostgres({ containerName });
  console.log("[project:postgres] docker container destroyed");

  // 3. Delete resource from DB (cascades to database_resource)
  await db.delete(resource).where(eq(resource.id, input.resourceId));
  console.log("[project:postgres] database record deleted");

  // 4. Reconcile Caddy to remove the route
  console.log("[project:postgres] running caddy reconciliation after delete");
  await reconcile();

  return { ok: true };
}

export async function listProjectProxyRoutes(input: {
  projectId: string;
}): Promise<ListProxyRoutesResult> {
  const project = await getProjectRecord(input.projectId);
  if (!project) {
    return { ok: false, reason: "project_not_found" };
  }

  const records = await listProxyRoutesByProject(input.projectId);

  return {
    ok: true,
    routes: records.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      resourceId: r.resourceId,
      type: r.type,
      domain: r.domain,
      upstreamHost: r.upstreamHost,
      upstreamPort: r.upstreamPort,
      protocol: r.protocol,
      layer4Alpn: r.layer4Alpn,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

function mapProject(record: {
  id: string;
  name: string;
  slug: string;
  environmentId: string;
  createdAt: Date;
  updatedAt: Date;
}): ProjectView {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    environmentId: record.environmentId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function mapDatabaseResource(
  record: DatabaseResourceRecord,
  projectSlug?: string,
): Promise<PostgresResourceView> {
  const resolvedProjectSlug =
    projectSlug ?? (await getProjectRecord(record.resource.projectId))?.slug ?? record.resource.projectId;
  const hydrated = await ensureDockerRuntimeForRecord(record, resolvedProjectSlug);
  const runtime = hydrated.runtime;
  const databaseRecord = hydrated.record.database;

  return {
    resourceId: record.resource.id,
    projectId: record.resource.projectId,
    name: record.resource.name,
    type: "database" as const,
    status: record.resource.status,
    engine: "postgres" as const,
    databaseName: databaseRecord.databaseName,
    username: databaseRecord.username,
    password: databaseRecord.password,
    publicHostname: databaseRecord.publicHostname,
    publicPort: databaseRecord.publicPort,
    publicConnectionString: databaseRecord.publicConnectionString,
    internalHostname: databaseRecord.internalHostname,
    internalPort: databaseRecord.internalPort,
    internalConnectionString: databaseRecord.internalConnectionString,
    localConnectionString:
      runtime.hostPort === null
        ? null
        : buildConnectionString({
            username: databaseRecord.username,
            password: databaseRecord.password,
            hostname: env.DATABASE_LOCAL_HOST,
            port: runtime.hostPort,
            databaseName: databaseRecord.databaseName,
          }),
    upstreamHost: databaseRecord.upstreamHost,
    upstreamPort: databaseRecord.upstreamPort,
    runtime,
  };
}

async function ensureDockerRuntimeForRecord(
  record: DatabaseResourceRecord,
  projectSlug: string,
): Promise<{ record: DatabaseResourceRecord; runtime: DockerPostgresRuntime }> {
  const containerName = buildContainerName({ projectSlug, resourceName: record.resource.name });
  const volumeName = buildVolumeName({ projectSlug, resourceName: record.resource.name });
  const existingRuntime = await inspectDockerPostgresRuntime({ containerName, volumeName });

  if (existingRuntime.status !== "missing") {
    return { record, runtime: existingRuntime };
  }

  const runtime = await provisionDockerPostgres({
    containerName,
    volumeName,
    hostnameAlias: record.database.internalHostname,
    databaseName: record.database.databaseName,
    username: record.database.username,
    password: record.database.password,
  });

  if (runtime.hostPort === null) {
    return { record, runtime };
  }

  const existingRoute = await getProxyRouteByResourceId(record.resource.id);
  if (existingRoute) {
    await updateProxyRoute(existingRoute.id, {
      upstreamHost: record.database.internalHostname,
      upstreamPort: env.DATABASE_INTERNAL_PORT,
    });
  }

  await updateDatabaseResourceRuntime({
    resourceId: record.resource.id,
    upstreamHost: record.database.internalHostname,
    upstreamPort: env.DATABASE_INTERNAL_PORT,
    caddyLayer4Snippet: "",
  });

  const reconcileResult = await reconcile();
  const isApplied = reconcileResult.applied.includes(record.resource.projectId);

  await updateDatabaseResourceStatus(
    record.resource.id,
    isApplied ? "valid" : "invalid",
  );

  return {
    record: {
      resource: { ...record.resource, status: isApplied ? "valid" : "invalid" },
      database: {
        ...record.database,
        upstreamHost: record.database.internalHostname,
        upstreamPort: env.DATABASE_INTERNAL_PORT,
        caddyLayer4Snippet: "",
      },
    },
    runtime,
  };
}

function sanitizeDatabaseName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "database";
}

function clampPostgresIdentifier(value: string): string {
  return value.slice(0, 63);
}

function buildContainerName(input: { projectSlug: string; resourceName: string }) {
  return sanitizeDockerName(
    `otterstack-pg-${sanitizeProjectSlug(input.projectSlug)}-${sanitizeDatabaseName(input.resourceName)}`,
  );
}

function buildVolumeName(input: { projectSlug: string; resourceName: string }) {
  return sanitizeDockerName(
    `otterstack-pgdata-${sanitizeProjectSlug(input.projectSlug)}-${sanitizeDatabaseName(input.resourceName)}`,
  );
}

function buildConnectionString(input: {
  username: string;
  password: string;
  hostname: string;
  port: number;
  databaseName: string;
  sslmode?: "require";
}) {
  const url = new URL(`postgres://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.hostname}:${input.port}/${encodeURIComponent(input.databaseName)}`);

  if (input.sslmode) {
    url.searchParams.set("sslmode", input.sslmode);
  }

  return url.toString();
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function sanitizeDockerName(value: string) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized.slice(0, 63) || "otterstack-postgres";
}
