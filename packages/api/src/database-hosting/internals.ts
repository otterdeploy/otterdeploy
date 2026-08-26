/**
 * Host resolution + the admin transport for shared database servers.
 *
 * A tenant has no container of its own, so every statement it needs runs
 * inside its HOST's container, over the same docker-exec path the data viewer
 * and the backup engine use (`backups/exec`). Nothing connects over the
 * overlay network from the control plane, so admin credentials never leave the
 * host machine.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, project, resource } from "@otterdeploy/db/schema";
import { Docker } from "@otterdeploy/docker";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { HostAdmin, TenantStatement } from "../swarm/database-engines/tenancy";

import { execCapture, findResourceContainerId } from "../backups/exec";
import { getTenancy } from "../swarm/database-engines/tenancy";

export class DatabaseHostingError extends Error {
  /** Machine-readable reason, mapped to typed oRPC errors by the routers. */
  readonly reason:
    | "host_not_found"
    | "engine_mismatch"
    | "engine_unsupported"
    | "host_is_tenant"
    | "host_not_running"
    | "statement_failed";
  constructor(reason: DatabaseHostingError["reason"], message: string) {
    super(message);
    this.name = "DatabaseHostingError";
    this.reason = reason;
  }
}

export interface HostRow {
  resourceId: ResourceId;
  projectId: ProjectId;
  /** The host project's slug: the container and volume names are derived from
   *  it, and a tenant in another project needs the HOST's, not its own. */
  projectSlug: string;
  name: string;
  engine: DatabaseEngine;
  admin: HostAdmin;
  internalHostname: string;
  internalPort: number;
  /** Set when this row is itself a tenant — hosting on a tenant is refused. */
  hostResourceId: ResourceId | null;
}

/** Load a host by id, org-scoped. Returns null when the id names nothing the
 *  caller's organization owns, so a cross-org id is indistinguishable from a
 *  missing one. */
export async function getHostRow(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
}): Promise<HostRow | null> {
  const [row] = await db
    .select({
      resourceId: resource.id,
      projectId: resource.projectId,
      projectSlug: project.slug,
      name: resource.name,
      engine: databaseResource.engine,
      username: databaseResource.username,
      password: databaseResource.password,
      databaseName: databaseResource.databaseName,
      internalHostname: databaseResource.internalHostname,
      internalPort: databaseResource.internalPort,
      hostResourceId: databaseResource.hostResourceId,
    })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(databaseResource.resourceId, input.resourceId),
        eq(project.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    resourceId: row.resourceId,
    projectId: row.projectId,
    projectSlug: row.projectSlug,
    name: row.name,
    engine: row.engine,
    admin: {
      username: row.username,
      password: row.password,
      databaseName: row.databaseName,
    },
    internalHostname: row.internalHostname,
    internalPort: row.internalPort,
    hostResourceId: row.hostResourceId,
  };
}

/** The id of the resource whose CONTAINER backs this resource: itself for a
 *  dedicated database, its host for a tenant. The one lookup every exec path
 *  needs — see `backups/exec.findResourceContainerId`, which calls it so the
 *  data viewer, backups and ephemeral credentials all resolve tenants without
 *  knowing tenants exist. */
export async function containerResourceId(resourceId: string): Promise<string> {
  // The caller (findResourceContainerId) is deliberately untyped here: it
  // resolves SERVICE ids too, which never match a database row. Compare on the
  // text column via sql`` rather than the branded `.$type<ResourceId>()`
  // column, so a plain string id doesn't need an assertion to be looked up.
  const [row] = await db
    .select({ hostResourceId: databaseResource.hostResourceId })
    .from(databaseResource)
    .where(sql`${databaseResource.resourceId} = ${resourceId}`)
    .limit(1);
  return row?.hostResourceId ?? resourceId;
}

/** Every tenant living on a host, base rows only (a preview branch of a
 *  tenant is listed under its own preview, not here). */
export async function listTenantRows(hostResourceId: ResourceId) {
  return db
    .select({
      resourceId: resource.id,
      projectId: resource.projectId,
      name: resource.name,
      status: resource.status,
      databaseName: databaseResource.databaseName,
      username: databaseResource.username,
      connectionLimit: databaseResource.connectionLimit,
      createdAt: resource.createdAt,
    })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .where(and(eq(databaseResource.hostResourceId, hostResourceId), isNull(resource.previewId)));
}

/**
 * Run one admin statement inside the host's container.
 *
 * `tolerate` (see TenantStatement) forgives the one class of error a
 * statement can't avoid — a duplicate object on a re-run — and nothing else:
 * any other non-zero exit throws, so a half-applied plan surfaces instead of
 * reporting a tenant that was never carved out.
 */
export async function runAdminStatement(
  host: HostRow,
  statement: TenantStatement,
): Promise<string> {
  const tenancy = getTenancy(host.engine);
  if (!tenancy) {
    throw new DatabaseHostingError(
      "engine_unsupported",
      `${host.engine} cannot host other databases`,
    );
  }
  const command = tenancy.adminCommand(host.admin, statement.sql);
  const docker = Docker.fromEnv();
  try {
    const containerId = await findResourceContainerId(docker, host.resourceId);
    if (!containerId) {
      throw new DatabaseHostingError(
        "host_not_running",
        `database server "${host.name}" is not running`,
      );
    }
    const result = await execCapture(docker, containerId, command.argv, {
      env: command.env,
      allowNonZero: true,
    });
    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      if (statement.tolerate?.test(detail)) return result.stdout;
      throw new DatabaseHostingError(
        "statement_failed",
        detail || `statement failed on "${host.name}"`,
      );
    }
    // mongosh reports a failed script on stdout with exit code 0, so a
    // zero exit is not on its own proof the statement did anything.
    if (/MongoServerError|uncaught exception/i.test(result.stdout)) {
      const detail = result.stdout.trim();
      if (statement.tolerate?.test(detail)) return result.stdout;
      throw new DatabaseHostingError("statement_failed", detail);
    }
    return result.stdout;
  } finally {
    docker.destroy();
  }
}
