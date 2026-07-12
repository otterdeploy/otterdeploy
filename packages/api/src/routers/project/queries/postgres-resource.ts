import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { PreviewId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, resource } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";
import { createError } from "evlog";

export interface DatabaseResourceRecord {
  resource: typeof resource.$inferSelect;
  database: typeof databaseResource.$inferSelect;
}

export async function getDatabaseResourceByProjectAndName(projectId: ProjectId, name: string) {
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

export async function getDatabaseResourceRecord(projectId: ProjectId, resourceId: ResourceId) {
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
  engine?: DatabaseEngine;
  status?: "draft" | "valid" | "invalid";
  /** Preview scoping for a branched DB (a preview's copy). Omitted → NULL
   *  (base resource). See docs/designs/pr-previews.md. */
  previewId?: PreviewId;
  branchedFromResourceId?: ResourceId;
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
  /** Extensions the create bakes in (manifest creates resolve the image from
   *  these up-front, so no post-create image-swap redeploy is needed). */
  extensions?: string[];
  /** User env vars the create bakes into the container, so no post-create
   *  env-roll redeploy is needed. */
  extraEnv?: Record<string, string>;
}): Promise<DatabaseResourceRecord> {
  return db.transaction(async (tx) => {
    const [createdResource] = await tx
      .insert(resource)
      .values({
        projectId: input.projectId,
        name: input.name,
        type: "database",
        status: input.status ?? "valid",
        previewId: input.previewId,
        branchedFromResourceId: input.branchedFromResourceId,
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
        ...(input.extensions && input.extensions.length > 0
          ? { extensions: input.extensions }
          : {}),
        ...(input.extraEnv && Object.keys(input.extraEnv).length > 0
          ? { extraEnv: input.extraEnv }
          : {}),
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
export async function setDatabaseResourcePublic(resourceId: ResourceId, publicEnabled: boolean) {
  const [updated] = await db
    .update(databaseResource)
    .set({ publicEnabled, updatedAt: new Date() })
    .where(eq(databaseResource.resourceId, resourceId))
    .returning();
  return updated;
}

/** Toggle PR-preview branching for a database. Pure flag write — takes effect
 *  on the next PR open/synchronize; no container roll. */
export async function setDatabaseResourcePreviewBranching(
  resourceId: ResourceId,
  previewBranching: boolean,
) {
  const [updated] = await db
    .update(databaseResource)
    .set({ previewBranching, updatedAt: new Date() })
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

/** Persist the enabled-extensions list for a database resource. Caller is
 *  responsible for rolling the swarm service (the image may change) and
 *  applying CREATE/DROP EXTENSION against the live database afterward. */
export async function setDatabaseResourceExtensions(resourceId: ResourceId, extensions: string[]) {
  const [updated] = await db
    .update(databaseResource)
    .set({ extensions, updatedAt: new Date() })
    .where(eq(databaseResource.resourceId, resourceId))
    .returning();
  return updated;
}
