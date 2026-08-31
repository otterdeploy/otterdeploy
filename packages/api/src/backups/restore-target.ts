/**
 * The database a restore writes INTO.
 *
 * Split from context.ts on its line cap. That file is about the context a
 * backup RUN carries; this is about resolving a restore's write target, and
 * the org scope on it is load-bearing: without it a caller could restore their
 * own snapshot into another tenant's database.
 */
import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, project, resource } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";

import { toBackupEngine, type DatabaseEngine } from "./context";

/**
 * Where a restore WRITES, which is not necessarily where the snapshot came
 * from.
 *
 * `getExecutionContext` resolves a run's own source; restoring a snapshot into
 * a *different* database needs the target's container coordinates and
 * credentials resolved independently of the backup row. Managed databases only:
 * a compose-stack service resolves through resolveStackDumpTarget instead.
 */
export interface DatabaseTarget {
  resourceId: ResourceId;
  resourceName: string;
  projectSlug: string;
  engine: DatabaseEngine;
  databaseName: string;
  username: string;
  password: string;
  /** Recorded container name. The container is found by LABEL here, so this
   *  only reaches error text — but a restore naming the wrong container
   *  mid-incident is its own harm. Optional: one caller has no row. od-jwx. */
  serviceName?: string | null;
}

export async function resolveDatabaseTarget(
  resourceId: ResourceId,
  /** Scope: the target must belong to the caller's org. Without this a caller
   *  could restore their own snapshot INTO another tenant's database. The
   *  snapshot is scoped upstream, the write target was not. */
  organizationId: OrganizationId,
): Promise<DatabaseTarget | null> {
  const [row] = await db
    .select({
      resourceId: resource.id,
      resourceName: resource.name,
      projectSlug: project.slug,
      engine: databaseResource.engine,
      databaseName: databaseResource.databaseName,
      username: databaseResource.username,
      password: databaseResource.password,
      serviceName: databaseResource.serviceName,
    })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(and(eq(resource.id, resourceId), eq(project.organizationId, organizationId)))
    .limit(1);
  if (!row || row.databaseName == null || row.username == null || row.password == null) {
    return null;
  }
  const engine = toBackupEngine(row.engine);
  if (!engine) return null;
  return {
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    projectSlug: row.projectSlug,
    engine,
    databaseName: row.databaseName,
    username: row.username,
    password: row.password,
    serviceName: row.serviceName,
  };
}
