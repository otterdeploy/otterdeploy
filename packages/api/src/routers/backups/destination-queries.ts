/**
 * Org-scoped DB queries for backup destinations. Split out of `queries.ts`.
 * The safe view never selects `encryptedSecret`; the with-secret read is the
 * single decrypt path for the `test`/engine flow.
 */
import type { BackupDestinationId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backup, backupDestination, backupSchedule } from "@otterdeploy/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";

export interface DestinationRow {
  destination: Omit<typeof backupDestination.$inferSelect, "encryptedSecret">;
  usedBytes: number;
}

// Safe view — never selects `encryptedSecret`.
const DESTINATION_VIEW = {
  id: backupDestination.id,
  organizationId: backupDestination.organizationId,
  name: backupDestination.name,
  type: backupDestination.type,
  config: backupDestination.config,
  status: backupDestination.status,
  createdAt: backupDestination.createdAt,
  updatedAt: backupDestination.updatedAt,
} as const;

export type DestinationView = Omit<typeof backupDestination.$inferSelect, "encryptedSecret">;

async function getDestinationForOrg(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
}): Promise<DestinationView | null> {
  const [row] = await db
    .select(DESTINATION_VIEW)
    .from(backupDestination)
    .where(
      and(
        eq(backupDestination.id, input.id),
        eq(backupDestination.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Includes the encrypted secret + config — for the `test`/engine decrypt path only. */
export async function getDestinationWithSecret(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
}): Promise<{
  type: "s3" | "local" | "sftp";
  config: Record<string, unknown>;
  encryptedSecret: string | null;
} | null> {
  const [row] = await db
    .select({
      type: backupDestination.type,
      config: backupDestination.config,
      encryptedSecret: backupDestination.encryptedSecret,
    })
    .from(backupDestination)
    .where(
      and(
        eq(backupDestination.id, input.id),
        eq(backupDestination.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createDestinationRecord(input: {
  organizationId: OrganizationId;
  name: string;
  type: "s3" | "local" | "sftp";
  config: Record<string, unknown>;
  encryptedSecret: string | null;
}): Promise<DestinationView> {
  const [row] = await db
    .insert(backupDestination)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      type: input.type,
      config: input.config,
      encryptedSecret: input.encryptedSecret,
    })
    .returning(DESTINATION_VIEW);
  if (!row) throw new Error("createDestinationRecord: insert returned no rows");
  return row;
}

export async function updateDestinationRecord(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
  name?: string;
  config?: Record<string, unknown>;
  encryptedSecret?: string;
}): Promise<DestinationView | null> {
  const patch: Partial<typeof backupDestination.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.config !== undefined) patch.config = input.config;
  if (input.encryptedSecret !== undefined) patch.encryptedSecret = input.encryptedSecret;

  if (Object.keys(patch).length === 0) {
    return getDestinationForOrg({
      organizationId: input.organizationId,
      id: input.id,
    });
  }

  const [row] = await db
    .update(backupDestination)
    .set(patch)
    .where(
      and(
        eq(backupDestination.id, input.id),
        eq(backupDestination.organizationId, input.organizationId),
      ),
    )
    .returning(DESTINATION_VIEW);
  return row ?? null;
}

/** Resolve destination ids → names (org-scoped), order-preserved. */
export async function resolveDestinationNames(input: {
  organizationId: OrganizationId;
  ids: BackupDestinationId[];
}): Promise<string[]> {
  if (input.ids.length === 0) return [];
  const dests = await db
    .select({ id: backupDestination.id, name: backupDestination.name })
    .from(backupDestination)
    .where(eq(backupDestination.organizationId, input.organizationId));
  const nameById = new Map(dests.map((d) => [d.id, d.name]));
  return input.ids.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n));
}

/** Count schedules + backups still pointing at a destination (delete guard). */
export async function countDestinationReferences(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
}): Promise<number> {
  const [sched] = await db
    .select({ n: sql<string>`count(*)` })
    .from(backupSchedule)
    // jsonb containment: schedules whose destinationIds array holds this id.
    .where(sql`${backupSchedule.destinationIds} @> ${JSON.stringify([input.id])}::jsonb`);
  const [bak] = await db
    .select({ n: sql<string>`count(*)` })
    .from(backup)
    .where(eq(backup.destinationId, input.id));
  return Number(sched?.n ?? 0) + Number(bak?.n ?? 0);
}

export async function deleteDestinationRecord(input: {
  organizationId: OrganizationId;
  id: BackupDestinationId;
}): Promise<{ id: BackupDestinationId } | null> {
  const [row] = await db
    .delete(backupDestination)
    .where(
      and(
        eq(backupDestination.id, input.id),
        eq(backupDestination.organizationId, input.organizationId),
      ),
    )
    .returning({ id: backupDestination.id });
  return row ?? null;
}

export async function listDestinationsByOrg(
  organizationId: OrganizationId,
): Promise<DestinationRow[]> {
  const rows = await db
    .select({
      id: backupDestination.id,
      organizationId: backupDestination.organizationId,
      name: backupDestination.name,
      type: backupDestination.type,
      config: backupDestination.config,
      status: backupDestination.status,
      createdAt: backupDestination.createdAt,
      updatedAt: backupDestination.updatedAt,
      // bigint sum comes back as a string in pg; coerce in JS below.
      usedBytes: sql<string>`coalesce(sum(${backup.compressedSizeBytes}), 0)`,
    })
    .from(backupDestination)
    .leftJoin(backup, eq(backup.destinationId, backupDestination.id))
    .where(eq(backupDestination.organizationId, organizationId))
    .groupBy(backupDestination.id)
    .orderBy(asc(backupDestination.createdAt));

  return rows.map(({ usedBytes, ...destination }) => ({
    destination,
    usedBytes: Number(usedBytes) || 0,
  }));
}
