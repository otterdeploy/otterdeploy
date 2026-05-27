/**
 * DB-facing helpers for container registry credentials.
 *
 * Encryption is applied at the boundary here: callers pass plaintext,
 * we encryptSecret() before INSERT/UPDATE, and we never SELECT the
 * encrypted_password column for the "view" shape. The decrypted path
 * lives in swarm/registry-auth.ts (resolveRegistryAuth) and the build
 * pipeline (apps/builder/src/pipeline.ts) — those two call sites are
 * the only places plaintext is reconstructed.
 */

import { db } from "@otterstack/db";
import { containerRegistry, project } from "@otterstack/db/schema";
import { type Id, ID_PREFIX as IDP } from "@otterstack/shared/id";
import { and, asc, eq } from "drizzle-orm";

import { encryptSecret } from "../../lib/crypto";

type OrgId = Id<typeof IDP.organization>;
type RegistryId = Id<typeof IDP.containerRegistry>;

const VIEW_COLUMNS = {
  id: containerRegistry.id,
  displayName: containerRegistry.displayName,
  host: containerRegistry.host,
  username: containerRegistry.username,
  authType: containerRegistry.authType,
  createdAt: containerRegistry.createdAt,
  updatedAt: containerRegistry.updatedAt,
} as const;

/**
 * Canonical host: lowercase, with the implicit Docker Hub form
 * collapsed to the registry hostname `resolveRegistryAuth` will
 * compare against. Operators sometimes paste "https://ghcr.io" or
 * "docker.io/" — strip the scheme + trailing slash so a credential
 * added that way still matches images under the bare hostname.
 */
export function canonicalizeHost(input: string): string {
  let s = input.trim().toLowerCase();
  if (s.startsWith("https://")) s = s.slice("https://".length);
  if (s.startsWith("http://")) s = s.slice("http://".length);
  if (s.endsWith("/")) s = s.slice(0, -1);
  // Common aliases for Docker Hub.
  if (s === "hub.docker.com" || s === "registry-1.docker.io") s = "docker.io";
  return s;
}

export async function listRegistriesForOrg(organizationId: OrgId) {
  return db
    .select(VIEW_COLUMNS)
    .from(containerRegistry)
    .where(eq(containerRegistry.organizationId, organizationId))
    .orderBy(asc(containerRegistry.createdAt));
}

export async function findRegistryByOrgHostUser(
  organizationId: OrgId,
  host: string,
  username: string,
) {
  const [row] = await db
    .select(VIEW_COLUMNS)
    .from(containerRegistry)
    .where(
      and(
        eq(containerRegistry.organizationId, organizationId),
        eq(containerRegistry.host, host),
        eq(containerRegistry.username, username),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getRegistryForOrg(
  organizationId: OrgId,
  id: RegistryId,
) {
  const [row] = await db
    .select(VIEW_COLUMNS)
    .from(containerRegistry)
    .where(
      and(
        eq(containerRegistry.id, id),
        eq(containerRegistry.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createRegistryRecord(input: {
  organizationId: OrgId;
  displayName: string;
  host: string;
  username: string;
  plaintextPassword: string;
  authType: "password" | "token";
}) {
  const encrypted = await encryptSecret(input.plaintextPassword);
  const rows = await db
    .insert(containerRegistry)
    .values({
      organizationId: input.organizationId,
      displayName: input.displayName,
      host: canonicalizeHost(input.host),
      username: input.username,
      encryptedPassword: encrypted,
      authType: input.authType,
    })
    .returning(VIEW_COLUMNS);
  // RETURNING on a successful single-row INSERT always yields one row;
  // if drizzle ever gives back an empty array here, something has gone
  // very wrong and the surfaced error makes that obvious.
  const [row] = rows;
  if (!row) throw new Error("createRegistryRecord: insert returned no rows");
  return row;
}

export async function updateRegistryRecord(input: {
  organizationId: OrgId;
  id: RegistryId;
  displayName?: string;
  username?: string;
  /** Plaintext. Omit / empty to leave the existing password in place. */
  plaintextPassword?: string;
  authType?: "password" | "token";
}) {
  const patch: Partial<typeof containerRegistry.$inferInsert> = {};
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.username !== undefined) patch.username = input.username;
  if (input.authType !== undefined) patch.authType = input.authType;
  if (input.plaintextPassword) {
    patch.encryptedPassword = await encryptSecret(input.plaintextPassword);
  }

  if (Object.keys(patch).length === 0) {
    return getRegistryForOrg(input.organizationId, input.id);
  }

  const [row] = await db
    .update(containerRegistry)
    .set(patch)
    .where(
      and(
        eq(containerRegistry.id, input.id),
        eq(containerRegistry.organizationId, input.organizationId),
      ),
    )
    .returning(VIEW_COLUMNS);
  return row ?? null;
}

/**
 * Delete a registry credential. Projects that pointed at it lose the
 * binding — the column is set NULL so the next build of those projects
 * fails fast with a clear "no registry configured" error rather than
 * crashing inside the docker push step.
 */
export async function deleteRegistryRecord(input: {
  organizationId: OrgId;
  id: RegistryId;
}) {
  return db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({ containerRegistryId: null })
      .where(
        and(
          eq(project.organizationId, input.organizationId),
          eq(project.containerRegistryId, input.id),
        ),
      );
    const [deleted] = await tx
      .delete(containerRegistry)
      .where(
        and(
          eq(containerRegistry.id, input.id),
          eq(containerRegistry.organizationId, input.organizationId),
        ),
      )
      .returning({ id: containerRegistry.id });
    return deleted ?? null;
  });
}
