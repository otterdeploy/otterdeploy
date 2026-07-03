import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  databaseDraftCredential,
  databaseResource,
  resource,
} from "@otterdeploy/db/schema/project";
import { and, eq, notInArray } from "drizzle-orm";
import { createError } from "evlog";
import { randomBytes } from "node:crypto";

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
  /** Environment scoping for a branched DB (a preview's copy). Omitted → NULL
   *  (base resource). See docs/designs/pr-previews.md. */
  environmentId?: EnvironmentId;
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
}): Promise<DatabaseResourceRecord> {
  return db.transaction(async (tx) => {
    const [createdResource] = await tx
      .insert(resource)
      .values({
        projectId: input.projectId,
        name: input.name,
        type: "database",
        status: input.status ?? "valid",
        environmentId: input.environmentId,
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

// ── Draft credentials (staged-but-not-provisioned databases) ───────────
//
// The password for a staged database is minted once and reused at deploy, so
// the connection details shown in the pending panel keep working afterward.
// Keyed by (projectId, name) — the manifest's identity for the entry.

/** Return the staged password for (projectId, name), minting + storing one on
 *  first call. Idempotent: subsequent calls return the same password. */
export async function ensureDraftCredentialPassword(
  projectId: ProjectId,
  name: string,
): Promise<string> {
  const existing = await getDraftCredentialPassword(projectId, name);
  if (existing) return existing;
  const password = randomBytes(18).toString("base64url");
  // ON CONFLICT DO NOTHING guards the race where two callers mint at once;
  // we then re-read so both observe the single winning password.
  await db
    .insert(databaseDraftCredential)
    .values({ projectId, name, password })
    .onConflictDoNothing();
  return (await getDraftCredentialPassword(projectId, name)) ?? password;
}

/** Read the staged password for (projectId, name), or null if none minted. */
export async function getDraftCredentialPassword(
  projectId: ProjectId,
  name: string,
): Promise<string | null> {
  const [row] = await db
    .select({ password: databaseDraftCredential.password })
    .from(databaseDraftCredential)
    .where(
      and(eq(databaseDraftCredential.projectId, projectId), eq(databaseDraftCredential.name, name)),
    )
    .limit(1);
  return row?.password ?? null;
}

/** Drop the draft credential once the real database row exists (post-deploy). */
export async function deleteDraftCredential(projectId: ProjectId, name: string): Promise<void> {
  await db
    .delete(databaseDraftCredential)
    .where(
      and(eq(databaseDraftCredential.projectId, projectId), eq(databaseDraftCredential.name, name)),
    );
}

/** Discard cleanup: drop any draft credentials whose database name is no
 *  longer present in the (reverted) manifest. Passing an empty keep-list
 *  clears them all for the project. */
export async function deleteDraftCredentialsNotIn(
  projectId: ProjectId,
  keepNames: string[],
): Promise<void> {
  await db
    .delete(databaseDraftCredential)
    .where(
      keepNames.length === 0
        ? eq(databaseDraftCredential.projectId, projectId)
        : and(
            eq(databaseDraftCredential.projectId, projectId),
            notInArray(databaseDraftCredential.name, keepNames),
          ),
    );
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
