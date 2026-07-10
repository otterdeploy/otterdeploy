/**
 * Draft credentials (staged-but-not-provisioned databases).
 *
 * The password for a staged database is minted once and reused at deploy, so
 * the connection details shown in the pending panel keep working afterward.
 * Keyed by (projectId, name) — the manifest's identity for the entry.
 * Split out of postgres-resource.ts, which keeps the database_resource CRUD.
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseDraftCredential } from "@otterdeploy/db/schema/project";
import { and, eq, notInArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";

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
