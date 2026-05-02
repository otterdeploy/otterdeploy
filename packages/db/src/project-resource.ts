import { and, eq } from "drizzle-orm";

import { db } from "./client";
import { databaseResource, project, resource } from "./schema/project";

export type DatabaseResourceRecord = {
  resource: typeof resource.$inferSelect;
  database: typeof databaseResource.$inferSelect;
};

export async function getProjectRecord(projectId: string) {
  const [record] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
  return record;
}

export async function getDatabaseResourceByProjectAndName(projectId: string, name: string) {
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

export async function getDatabaseResourceRecord(projectId: string, resourceId: string) {
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

export async function listDatabaseResourceRecords(projectId: string) {
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
  projectId: string;
  name: string;
  status?: "draft" | "valid" | "invalid";
  databaseName: string;
  username: string;
  password: string;
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
      throw new Error("Failed to create database resource.");
    }

    const resourceId = createdResource.id;

    const [createdDatabase] = await tx
      .insert(databaseResource)
      .values({
        resourceId,
        engine: "postgres",
        databaseName: input.databaseName,
        username: input.username,
        password: input.password,
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
      throw new Error("Failed to create database credentials.");
    }

    return {
      resource: createdResource,
      database: createdDatabase,
    };
  });
}

export async function updateDatabaseResourceStatus(
  resourceId: string,
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
  resourceId: string;
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
