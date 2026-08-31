/**
 * Resolving "which database, reached how".
 *
 * A target is deliberately a value, not a resource id: the runtime above it
 * does not care whether the credentials came from a managed `database_resource`
 * row or from an external connection string an operator pasted in, and keeping
 * that distinction out of the execute path is what lets the same workbench
 * serve both.
 *
 * `mode` is carried on the target rather than passed per call, because
 * read-only has to be a property of the SESSION. A per-statement check is a
 * classifier, and a classifier can be defeated by a CTE or a stored procedure.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, project, resource } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";

import { DataError } from "./errors";

export type AccessMode = "read-only" | "read-write";

export interface DataTarget {
  /** Stable key for the connection pool. Never contains the password. */
  poolKey: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** TLS for external targets; managed ones ride the private overlay network. */
  tls: boolean;
  mode: AccessMode;
  /** Present for managed targets, so audit rows can name the resource. */
  resourceId: ResourceId | null;
  /** Human label for logs and error messages. Never a secret. */
  label: string;
}

/**
 * Resolve a managed database resource to a target.
 *
 * Uses `internalHostname`/`internalPort` — the service's DNS alias on the
 * project's overlay network — rather than the public edge. The control plane is
 * on that network, so this is a direct hop that never leaves the cluster and
 * never depends on the database being publicly exposed at all.
 */
export async function resolveManagedTarget(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  mode: AccessMode;
}): Promise<DataTarget> {
  const [row] = await db
    .select({
      engine: databaseResource.engine,
      username: databaseResource.username,
      password: databaseResource.password,
      databaseName: databaseResource.databaseName,
      internalHostname: databaseResource.internalHostname,
      internalPort: databaseResource.internalPort,
      resourceId: resource.id,
      resourceName: resource.name,
      projectSlug: project.slug,
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

  if (!row) {
    throw new DataError("not_found", `database ${input.resourceId} not found`);
  }

  return {
    // Mode is part of the key: a read-only and a read-write session against the
    // same database must never share a pooled connection, or the read-only
    // guarantee lasts exactly until someone else's write checks the socket out.
    poolKey: `res:${row.resourceId}:${input.mode}`,
    engine: row.engine,
    host: row.internalHostname,
    port: row.internalPort,
    database: row.databaseName,
    username: row.username,
    password: row.password,
    tls: false,
    mode: input.mode,
    resourceId: row.resourceId,
    label: `${row.projectSlug}/${row.resourceName}`,
  };
}
