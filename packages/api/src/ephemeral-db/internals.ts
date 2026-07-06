/**
 * Shared internals for ephemeral database credentials — target resolution and
 * the docker-exec psql transport (same path as the data viewer / backups).
 * Split out of index.ts to keep both halves under the file-length cap.
 */
import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, project, resource } from "@otterdeploy/db/schema";
import { Docker } from "@otterdeploy/docker";
import { and, eq } from "drizzle-orm";

import { execCapture, findResourceContainerId } from "../backups/exec";

export class EphemeralDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EphemeralDbError";
  }
}

export interface EphemeralTarget {
  resourceId: ResourceId;
  engine: string;
  /** The owning app role — psql runs as it, and read-write grants membership in it. */
  ownerUsername: string;
  ownerPassword: string;
  databaseName: string;
  publicEnabled: boolean;
  publicHostname: string;
  internalHostname: string;
  internalPort: number;
}

export async function getTarget(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
}): Promise<EphemeralTarget | null> {
  const [row] = await db
    .select({
      resourceId: resource.id,
      engine: databaseResource.engine,
      ownerUsername: databaseResource.username,
      ownerPassword: databaseResource.password,
      databaseName: databaseResource.databaseName,
      publicEnabled: databaseResource.publicEnabled,
      publicHostname: databaseResource.publicHostname,
      internalHostname: databaseResource.internalHostname,
      internalPort: databaseResource.internalPort,
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
  return row ?? null;
}

/** Quote a SQL identifier (embedded double quotes doubled). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a SQL text literal (embedded single quotes doubled). */
export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Run `sql` in the resource's container as the owning app role. */
export async function runAsOwner(target: EphemeralTarget, sql: string): Promise<void> {
  const docker = Docker.fromEnv();
  try {
    const containerId = await findResourceContainerId(docker, target.resourceId);
    if (!containerId) {
      throw new EphemeralDbError("database container is not running");
    }
    const result = await execCapture(
      docker,
      containerId,
      [
        "psql",
        "-U",
        target.ownerUsername,
        "-d",
        target.databaseName,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
      ],
      { env: [`PGPASSWORD=${target.ownerPassword}`], allowNonZero: true },
    );
    if (result.exitCode !== 0) {
      throw new EphemeralDbError(result.stderr.trim() || "statement failed");
    }
  } finally {
    docker.destroy();
  }
}

/** Kill live sessions and drop the role. Idempotent: a role that's already
 *  gone is a no-op, so retries and sweeper/manual races are safe. */
export async function dropRole(target: EphemeralTarget, roleName: string): Promise<void> {
  // DO block so the whole sequence no-ops when the role doesn't exist.
  // REASSIGN first — a read-write credential may own objects it created.
  await runAsOwner(
    target,
    `DO $$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = ${literal(roleName)}) THEN
        PERFORM pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = ${literal(roleName)};
        EXECUTE format('REASSIGN OWNED BY %I TO %I', ${literal(roleName)}, ${literal(target.ownerUsername)});
        EXECUTE format('DROP OWNED BY %I', ${literal(roleName)});
        EXECUTE format('DROP ROLE %I', ${literal(roleName)});
      END IF;
    END $$;`,
  );
}
