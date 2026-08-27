/**
 * DB-facing helpers for container registry credentials.
 *
 * Encryption is applied at the boundary here: callers pass plaintext, we
 * encryptForDomain(..., "registry-creds") before INSERT/UPDATE. A key
 * derived independently of every other secret category, see
 * packages/api/src/lib/crypto.ts, and we never SELECT the
 * encrypted_password column for the "view" shape. The decrypted paths
 * are swarm/registry-auth.ts (resolveRegistryAuth), the build pipeline
 * (apps/builder/src/pipeline.ts), and getRegistryCredentialForOrg below
 * (testConnection probe only, plaintext never leaves the server).
 */
import type { ContainerRegistryId, OrganizationId } from "@otterdeploy/shared/id";

import { ORPCError } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { containerRegistry, project, resource, serviceResource } from "@otterdeploy/db/schema";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import { GHCR_HOST, looksLikeInstallationToken } from "../../git/ghcr-policy";
import { decryptForDomain, encryptForDomain } from "../../lib/crypto";
import { parseImageRef } from "./tag-parse";

type OrgId = OrganizationId;
type RegistryId = ContainerRegistryId;

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
 * "docker.io/": strip the scheme + trailing slash so a credential
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

/**
 * host → number of distinct projects whose build pushes there.
 *
 * There is no FK to count. A service names its push target as a plain image
 * string (`serviceResource.imageRepository`) and the credential is matched by
 * that string's HOST at build time — see the column comment on project.ts and
 * `resolveRegistryAuth`. So the count has to be derived the same way the
 * builder derives auth, through {@link parseImageRef}, which is the one parser
 * both paths share. Deriving it any other way (a LIKE on the host, say) would
 * let the card's number disagree with where images actually land.
 *
 * Parsed in JS rather than SQL for exactly that reason: the rule for "is the
 * first segment a host" (a dot, a colon, or `localhost`) lives in one function
 * and is not worth reimplementing in a query.
 *
 * DISTINCT PROJECTS, not services: two services in one project pushing to the
 * same registry is one project depending on that credential, which is what an
 * operator is deciding about when they consider deleting it.
 */
async function countProjectsByRegistryHost(organizationId: OrgId): Promise<Map<string, number>> {
  const rows = await db
    .select({ projectId: resource.projectId, image: serviceResource.imageRepository })
    .from(serviceResource)
    .innerJoin(resource, eq(serviceResource.resourceId, resource.id))
    .innerJoin(project, eq(resource.projectId, project.id))
    .where(
      and(eq(project.organizationId, organizationId), isNotNull(serviceResource.imageRepository)),
    );

  const byHost = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.image === null) continue;
    const ref = parseImageRef(row.image);
    // An unparseable target pushes nowhere we can name, so it counts for no
    // registry rather than being attributed to a guess.
    if (ref === null) continue;
    let projects = byHost.get(ref.host);
    if (projects === undefined) {
      projects = new Set();
      byHost.set(ref.host, projects);
    }
    projects.add(row.projectId);
  }

  return new Map([...byHost].map(([host, projects]) => [host, projects.size]));
}

export async function listRegistriesForOrg(organizationId: OrgId) {
  const [rows, counts] = await Promise.all([
    db
      .select(VIEW_COLUMNS)
      .from(containerRegistry)
      .where(eq(containerRegistry.organizationId, organizationId))
      .orderBy(asc(containerRegistry.createdAt)),
    countProjectsByRegistryHost(organizationId),
  ]);
  return rows.map((row) => ({ ...row, projectCount: counts.get(row.host) ?? 0 }));
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

export async function getRegistryForOrg(organizationId: OrgId, id: RegistryId) {
  const [row] = await db
    .select(VIEW_COLUMNS)
    .from(containerRegistry)
    .where(and(eq(containerRegistry.id, id), eq(containerRegistry.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * host + username + DECRYPTED password for the testConnection probe.
 * The plaintext is used server-side for the registry handshake and is
 * never serialized into an RPC response: keep it that way.
 */
export async function getRegistryCredentialForOrg(organizationId: OrgId, id: RegistryId) {
  const [row] = await db
    .select({
      id: containerRegistry.id,
      host: containerRegistry.host,
      username: containerRegistry.username,
      encryptedPassword: containerRegistry.encryptedPassword,
    })
    .from(containerRegistry)
    .where(and(eq(containerRegistry.id, id), eq(containerRegistry.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    host: row.host,
    username: row.username,
    password: await decryptForDomain(row.encryptedPassword, "registry-creds"),
  };
}

/**
 * Decrypted credential for a HOST: the same "most recently updated wins"
 * rule `resolveRegistryAuth` applies at deploy time, so the tag browser
 * authenticates exactly like the eventual pull will. Null when the org
 * has no credential for that host (anonymous is the honest fallback).
 */
/**
 * Does a stored credential exist for this host?
 *
 * Separate from `getRegistryCredentialForOrgByHost` because the caller only
 * needs a yes/no and that one decrypts the password to answer it. Decrypting
 * a secret to decide what to draw is not something to do casually.
 */
export async function hasRegistryForHost(organizationId: OrgId, host: string): Promise<boolean> {
  const [row] = await db
    .select({ id: containerRegistry.id })
    .from(containerRegistry)
    .where(
      and(
        eq(containerRegistry.organizationId, organizationId),
        eq(containerRegistry.host, canonicalizeHost(host)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function getRegistryCredentialForOrgByHost(organizationId: OrgId, host: string) {
  const [row] = await db
    .select({
      id: containerRegistry.id,
      host: containerRegistry.host,
      username: containerRegistry.username,
      encryptedPassword: containerRegistry.encryptedPassword,
    })
    .from(containerRegistry)
    .where(
      and(
        eq(containerRegistry.organizationId, organizationId),
        eq(containerRegistry.host, canonicalizeHost(host)),
      ),
    )
    .orderBy(desc(containerRegistry.updatedAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    host: row.host,
    username: row.username,
    password: await decryptForDomain(row.encryptedPassword, "registry-creds"),
  };
}

/**
 * Refuse a stored credential that is really a short-lived installation token.
 *
 * See `looksLikeInstallationToken`: it works for about an hour and then fails
 * pulls far from where it was typed. The derived path (git/ghcr-auth.ts) is
 * what such a token is FOR, and it mints a fresh one per use.
 */
function rejectInstallationTokenAtRest(host: string, plaintextPassword: string): void {
  if (host !== GHCR_HOST || !looksLikeInstallationToken(plaintextPassword)) return;
  throw new ORPCError("BAD_REQUEST", {
    message:
      "That is a GitHub installation access token (ghs_…). It expires in about an hour, so storing it here would break pulls shortly after it appears to work. Connect the GitHub App instead — otterdeploy mints a fresh token per pull — or paste a personal access token with read:packages.",
  });
}

export async function createRegistryRecord(input: {
  organizationId: OrgId;
  displayName: string;
  host: string;
  username: string;
  plaintextPassword: string;
  authType: "password" | "token";
}) {
  const host = canonicalizeHost(input.host);
  rejectInstallationTokenAtRest(host, input.plaintextPassword);
  const encrypted = await encryptForDomain(input.plaintextPassword, "registry-creds");
  const rows = await db
    .insert(containerRegistry)
    .values({
      organizationId: input.organizationId,
      displayName: input.displayName,
      host,
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
  if (input.plaintextPassword) {
    // The host is not editable, so it has to be read back to know whether this
    // row is the one the guard applies to.
    const existing = await getRegistryForOrg(input.organizationId, input.id);
    if (existing) rejectInstallationTokenAtRest(existing.host, input.plaintextPassword);
  }

  const patch: Partial<typeof containerRegistry.$inferInsert> = {};
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.username !== undefined) patch.username = input.username;
  if (input.authType !== undefined) patch.authType = input.authType;
  if (input.plaintextPassword) {
    patch.encryptedPassword = await encryptForDomain(input.plaintextPassword, "registry-creds");
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
 * binding: the column is set NULL so the next build of those projects
 * fails fast with a clear "no registry configured" error rather than
 * crashing inside the docker push step.
 */
export async function deleteRegistryRecord(input: { organizationId: OrgId; id: RegistryId }) {
  // No project/service column to null anymore: services reference a registry by
  // the image target's HOST (matched at build time), not by id. Deleting the
  // credential just means a build pushing to that host fails with a clear "no
  // registry credential for <host>" until the operator re-adds one.
  const [deleted] = await db
    .delete(containerRegistry)
    .where(
      and(
        eq(containerRegistry.id, input.id),
        eq(containerRegistry.organizationId, input.organizationId),
      ),
    )
    .returning({ id: containerRegistry.id });
  return deleted ?? null;
}
