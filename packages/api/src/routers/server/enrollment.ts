import type { NodeEnrollmentId, OrganizationId, UserId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { nodeEnrollment } from "@otterdeploy/db/schema";
import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import type { EnrollmentRole } from "./enrollment-credential";

import { hashEnrollmentCredential, parseEnrollmentCredential } from "./enrollment-credential";
import { rotateSwarmJoinCredential } from "./enrollment-rotation";
import { getSwarmJoinTokens } from "./join-tokens";

const TOKEN_BYTES = 32;
const UNKNOWN = "—";

export { parseEnrollmentCredential } from "./enrollment-credential";
export { rotateSwarmJoinCredential, startNodeEnrollmentReaper } from "./enrollment-rotation";
export type { EnrollmentRole } from "./enrollment-credential";

export async function createNodeEnrollment(input: {
  organizationId: OrganizationId;
  createdByUserId: UserId;
  role: EnrollmentRole;
  ttlMinutes: number;
}) {
  const id = createId(ID_PREFIX.nodeEnrollment);
  const credential = `${id}.${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);
  const [created] = await db
    .insert(nodeEnrollment)
    .values({
      id,
      organizationId: input.organizationId,
      role: input.role,
      tokenHash: hashEnrollmentCredential(credential),
      createdByUserId: input.createdByUserId,
      expiresAt,
    })
    .returning({
      id: nodeEnrollment.id,
      role: nodeEnrollment.role,
      expiresAt: nodeEnrollment.expiresAt,
      createdAt: nodeEnrollment.createdAt,
    });
  if (!created) throw new Error("Failed to create node enrollment.");
  return { ...created, credential };
}

export async function listNodeEnrollments(organizationId: OrganizationId) {
  return db
    .select({
      id: nodeEnrollment.id,
      role: nodeEnrollment.role,
      expiresAt: nodeEnrollment.expiresAt,
      redeemedAt: nodeEnrollment.redeemedAt,
      completedAt: nodeEnrollment.completedAt,
      revokedAt: nodeEnrollment.revokedAt,
      createdAt: nodeEnrollment.createdAt,
    })
    .from(nodeEnrollment)
    .where(eq(nodeEnrollment.organizationId, organizationId))
    .orderBy(desc(nodeEnrollment.createdAt))
    .limit(50);
}

export async function isSwarmEnrollmentReady(role: EnrollmentRole): Promise<boolean> {
  const tokens = await getSwarmJoinTokens();
  const roleToken = role === "manager" ? tokens.manager : tokens.worker;
  return roleToken !== UNKNOWN && tokens.managerAddr !== UNKNOWN;
}

/**
 * Atomically consume an enrollment credential. No failure detail is exposed to
 * the unauthenticated caller, so invalid/expired/revoked/used all look alike.
 */
export async function redeemNodeEnrollment(credential: string) {
  const parsed = parseEnrollmentCredential(credential);
  if (!parsed) return null;
  const now = new Date();
  const [redeemed] = await db
    .update(nodeEnrollment)
    .set({ redeemedAt: now })
    .where(
      and(
        eq(nodeEnrollment.id, parsed.id),
        eq(nodeEnrollment.tokenHash, hashEnrollmentCredential(credential)),
        isNull(nodeEnrollment.redeemedAt),
        isNull(nodeEnrollment.revokedAt),
        gt(nodeEnrollment.expiresAt, now),
      ),
    )
    .returning({
      id: nodeEnrollment.id,
      role: nodeEnrollment.role,
      organizationId: nodeEnrollment.organizationId,
      expiresAt: nodeEnrollment.expiresAt,
    });
  if (!redeemed) return null;

  const tokens = await getSwarmJoinTokens();
  const joinToken = redeemed.role === "manager" ? tokens.manager : tokens.worker;
  if (joinToken === UNKNOWN || tokens.managerAddr === UNKNOWN) return null;

  // Close the redeem↔revoke/rotate race: if a protective action finished
  // before token delivery, do not hand the newly-rotated credential to an
  // enrollment that is now revoked. If it happens after this check, that
  // rotation invalidates the returned token instead.
  const [stillActive] = await db
    .select({ id: nodeEnrollment.id })
    .from(nodeEnrollment)
    .where(
      and(
        eq(nodeEnrollment.id, redeemed.id),
        eq(nodeEnrollment.tokenHash, hashEnrollmentCredential(credential)),
        isNull(nodeEnrollment.revokedAt),
      ),
    )
    .limit(1);
  if (!stillActive) return null;
  return { ...redeemed, joinToken, managerAddr: tokens.managerAddr };
}

export async function revokeNodeEnrollment(input: {
  id: NodeEnrollmentId;
  organizationId: OrganizationId;
}): Promise<boolean> {
  const [revoked] = await db
    .update(nodeEnrollment)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(nodeEnrollment.id, input.id),
        eq(nodeEnrollment.organizationId, input.organizationId),
        isNull(nodeEnrollment.revokedAt),
      ),
    )
    .returning({
      role: nodeEnrollment.role,
      redeemedAt: nodeEnrollment.redeemedAt,
      completedAt: nodeEnrollment.completedAt,
    });
  if (!revoked) return false;
  if (revoked.redeemedAt && !revoked.completedAt) {
    await rotateSwarmJoinCredential(revoked.role);
  }
  return true;
}

/**
 * Claim completion before rotating so duplicate completion calls cannot race
 * into multiple rotations. A failed rotation releases the claim for retry.
 */
export async function completeNodeEnrollment(credential: string): Promise<boolean> {
  const parsed = parseEnrollmentCredential(credential);
  if (!parsed) return false;
  const tokenHash = hashEnrollmentCredential(credential);
  const completedAt = new Date();
  const [claimed] = await db
    .update(nodeEnrollment)
    .set({ completedAt })
    .where(
      and(
        eq(nodeEnrollment.id, parsed.id),
        eq(nodeEnrollment.tokenHash, tokenHash),
        isNotNull(nodeEnrollment.redeemedAt),
        isNull(nodeEnrollment.completedAt),
        isNull(nodeEnrollment.revokedAt),
      ),
    )
    .returning({ role: nodeEnrollment.role });
  if (!claimed) return false;

  try {
    await rotateSwarmJoinCredential(claimed.role);
    return true;
  } catch (cause) {
    await db
      .update(nodeEnrollment)
      .set({ completedAt: null })
      .where(and(eq(nodeEnrollment.id, parsed.id), eq(nodeEnrollment.completedAt, completedAt)));
    throw cause;
  }
}
