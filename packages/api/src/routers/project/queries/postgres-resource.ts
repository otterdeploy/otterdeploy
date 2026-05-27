import { and, eq } from "drizzle-orm";
import { createError } from "evlog";

import { db } from "@otterstack/db";
import { databaseResource, resource } from "@otterstack/db/schema/project";

import type { ProjectId } from "../errors";
import type { ResourceId } from "../../service/errors";

export interface DatabaseResourceRecord {
  resource: typeof resource.$inferSelect;
  database: typeof databaseResource.$inferSelect;
}

export async function getDatabaseResourceByProjectAndName(
  projectId: ProjectId,
  name: string,
) {
  const [record] = await db
    .select({
      resource,
      database: databaseResource,
    })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.name, name)))
    .limit(1);

  return record;
}

export async function getDatabaseResourceRecord(
  projectId: ProjectId,
  resourceId: ResourceId,
) {
  const [record] = await db
    .select({
      resource,
      database: databaseResource,
    })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.id, resourceId)))
    .limit(1);

  return record;
}

export async function listDatabaseResourceRecords(projectId: ProjectId) {
  return db
    .select({
      resource,
      database: databaseResource,
    })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(eq(resource.projectId, projectId));
}

export async function createDatabaseResourceRecord(input: {
  projectId: ProjectId;
  name: string;
  /** Database engine. Defaults to postgres for back-compat with the
   *  original postgres-only call sites. New callers should always pass
   *  this explicitly. */
  engine?: "postgres" | "redis" | "mariadb" | "mongodb";
  status?: "draft" | "valid" | "invalid";
  databaseName: string;
  username: string;
  password: string;
  publicEnabled?: boolean;
  publicHostname: string;
  publicPort: number;
  publicConnectionString: string;
  internalHostname: string;
  internalPort: number;
  internalConnectionString: string;
  upstreamHost: string;
  upstreamPort: number;
  caddyLayer4Snippet: string;
}): Promise<DatabaseResourceRecord> {
  return db.transaction(async (tx) => {
    const [createdResource] = await tx
      .insert(resource)
      .values({
        projectId: input.projectId,
        name: input.name,
        type: "database",
        status: input.status ?? "valid",
      })
      .returning();

    if (!createdResource) {
      throw createError({
        message: "Failed to create database resource",
        status: 500,
        why: "Database insert returned no row for the resource",
      });
    }

    const resourceId = createdResource.id;

    const [createdDatabase] = await tx
      .insert(databaseResource)
      .values({
        resourceId,
        engine: input.engine ?? "postgres",
        databaseName: input.databaseName,
        username: input.username,
        password: input.password,
        publicEnabled: input.publicEnabled ?? false,
        publicHostname: input.publicHostname,
        publicPort: input.publicPort,
        publicConnectionString: input.publicConnectionString,
        internalHostname: input.internalHostname,
        internalPort: input.internalPort,
        internalConnectionString: input.internalConnectionString,
        upstreamHost: input.upstreamHost,
        upstreamPort: input.upstreamPort,
        caddyLayer4Snippet: input.caddyLayer4Snippet,
      })
      .returning();

    if (!createdDatabase) {
      throw createError({
        message: "Failed to create database credentials",
        status: 500,
        why: "Database insert returned no row for database credentials",
      });
    }

    return {
      resource: createdResource,
      database: createdDatabase,
    };
  });
}

export async function updateDatabaseResourceStatus(
  resourceId: ResourceId,
  status: "draft" | "valid" | "invalid",
) {
  const [updated] = await db
    .update(resource)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(resource.id, resourceId))
    .returning();

  return updated;
}

export async function updateDatabaseResourceRuntime(input: {
  resourceId: ResourceId;
  upstreamHost: string;
  upstreamPort: number;
  caddyLayer4Snippet: string;
}) {
  const [updated] = await db
    .update(databaseResource)
    .set({
      upstreamHost: input.upstreamHost,
      upstreamPort: input.upstreamPort,
      caddyLayer4Snippet: input.caddyLayer4Snippet,
      updatedAt: new Date(),
    })
    .where(eq(databaseResource.resourceId, input.resourceId))
    .returning();

  return updated;
}

/** Toggle the public-exposure flag on a database resource. Caller is
 *  responsible for registering / unregistering the matching proxy route
 *  and reconciling Caddy after this update. */
export async function setDatabaseResourcePublic(
  resourceId: ResourceId,
  publicEnabled: boolean,
) {
  const [updated] = await db
    .update(databaseResource)
    .set({ publicEnabled, updatedAt: new Date() })
    .where(eq(databaseResource.resourceId, resourceId))
    .returning();
  return updated;
}

export async function setDatabaseResourceExtraEnv(
  resourceId: ResourceId,
  extraEnv: Record<string, string>,
  secretKeys?: string[],
) {
  const [updated] = await db
    .update(databaseResource)
    .set({
      extraEnv,
      ...(secretKeys !== undefined ? { secretKeys } : {}),
      updatedAt: new Date(),
    })
    .where(eq(databaseResource.resourceId, resourceId))
    .returning();
  return updated;
}
