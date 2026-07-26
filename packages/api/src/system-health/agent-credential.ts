/**
 * Health-agent SESSION credential (od-5j8.20) — the per-node, short-lived,
 * DB-backed bearer an agent process presents on every `POST /api/agent/health`
 * after it has bootstrapped (see agent-register.ts). Same shape/idiom as
 * node_enrollment's credential (`{id}.{secret}`, only a SHA-256 digest
 * persisted — server/enrollment-credential.ts) rather than agent-token.ts's
 * stateless HMAC scheme: a session credential must be REVOCABLE before its
 * TTL expires (node removed from the swarm), which a pure HMAC token can't
 * be without a denylist — so this one is a real row.
 *
 * Bound to exactly one (serverId, hostname) pair at mint time. Every
 * `/api/agent/health` call authenticated with it MUST claim that same
 * hostname — a captured credential cannot be replayed to attribute a report
 * to a different node (the v1 gap the design doc's "Trust model v1" section
 * documented and od-5j8.20's audit flagged).
 */
import type { HealthAgentCredentialId, OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { healthAgentCredential } from "@otterdeploy/db/schema/server";
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { and, eq, isNull, lt } from "drizzle-orm";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const SECRET_BYTES = 32;
/** Deliberately short — far shorter than the old 1-year shared bearer.
 *  health-agent.ts refreshes well before this via `/register`; a captured
 *  credential is only ever useful for a bounded window even with no
 *  explicit revocation. */
export const SESSION_TTL_SECONDS = 60 * 60;

export function hashSessionSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** `{id}.{secret}` — same parse shape as node_enrollment's credential. */
export function parseSessionCredential(credential: string): { id: HealthAgentCredentialId } | null {
  const separator = credential.indexOf(".");
  if (separator < 1) return null;
  const id = credential.slice(0, separator);
  const secret = credential.slice(separator + 1);
  if (!/^hac_[a-z0-9]{24}$/.test(id) || !id.startsWith(`${ID_PREFIX.healthAgentCredential}_`)) {
    return null;
  }
  // randomBytes(32) → 43 base64url chars, exact bound (same reasoning as
  // enrollment-credential.ts: prevents oversized bearer inputs reaching a
  // DB/map lookup key).
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { id: id as HealthAgentCredentialId };
}

export interface IssuedCredential {
  credential: string;
  expiresAt: Date;
}

/** Mint + persist a new session credential bound to one server row. Does NOT
 *  revoke any prior credential for the same server — a rolling refresh can
 *  overlap briefly with the credential it's replacing, which is fine (both
 *  are equally narrow); node removal is what actually needs immediacy, and
 *  that revokes explicitly (see `revokeHealthAgentCredentialsForServer`). */
export async function issueSessionCredential(input: {
  serverId: ServerId;
  organizationId: OrganizationId;
  hostname: string;
}): Promise<IssuedCredential> {
  const id = createId(ID_PREFIX.healthAgentCredential);
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const credential = `${id}.${secret}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.insert(healthAgentCredential).values({
    id,
    serverId: input.serverId,
    organizationId: input.organizationId,
    hostname: input.hostname,
    tokenHash: hashSessionSecret(credential),
    expiresAt,
  });
  return { credential, expiresAt };
}

export interface VerifiedSession {
  serverId: ServerId;
  organizationId: OrganizationId;
  hostname: string;
}

/** Verify a session credential: well-formed, matches the stored digest, not
 *  expired, not revoked. Constant-time digest compare (the row lookup by id
 *  is not secret-dependent; only the secret half needs to be). Touches
 *  `lastSeenAt` best-effort on success. */
export async function verifySessionCredential(credential: string): Promise<VerifiedSession | null> {
  const parsed = parseSessionCredential(credential);
  if (!parsed) return null;

  const [row] = await db
    .select({
      serverId: healthAgentCredential.serverId,
      organizationId: healthAgentCredential.organizationId,
      hostname: healthAgentCredential.hostname,
      tokenHash: healthAgentCredential.tokenHash,
      expiresAt: healthAgentCredential.expiresAt,
      revokedAt: healthAgentCredential.revokedAt,
    })
    .from(healthAgentCredential)
    .where(eq(healthAgentCredential.id, parsed.id))
    .limit(1);
  if (!row) return null;

  const expectedHash = Buffer.from(row.tokenHash, "utf8");
  const presentedHash = Buffer.from(hashSessionSecret(credential), "utf8");
  if (expectedHash.length !== presentedHash.length || !timingSafeEqual(expectedHash, presentedHash)) {
    return null;
  }
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  await db
    .update(healthAgentCredential)
    .set({ lastSeenAt: new Date() })
    .where(eq(healthAgentCredential.id, parsed.id))
    .catch(() => undefined);

  return { serverId: row.serverId, organizationId: row.organizationId, hostname: row.hostname };
}

/**
 * Immediate revocation on node removal (od-5j8.20, and closes the credential
 * side of od-5j8.29's "no revocation on node removal" gap for this specific
 * credential type). Called from remove-node.ts right after the swarm detach
 * succeeds — belt-and-suspenders with the FK cascade delete that fires when
 * the server ROW itself is later deleted (deleteServerRecord), which covers
 * the case where this explicit call is ever skipped.
 */
export async function revokeHealthAgentCredentialsForServer(serverId: ServerId): Promise<void> {
  await db
    .update(healthAgentCredential)
    .set({ revokedAt: new Date() })
    .where(and(eq(healthAgentCredential.serverId, serverId), isNull(healthAgentCredential.revokedAt)));
}

/** Best-effort housekeeping — expired rows are already unusable (verify
 *  checks expiresAt), this just keeps the table from growing unbounded.
 *  Safe to call on any cadence; never throws. */
export async function pruneExpiredHealthAgentCredentials(): Promise<void> {
  await db.delete(healthAgentCredential).where(lt(healthAgentCredential.expiresAt, new Date()));
}
