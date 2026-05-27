/**
 * Organization-row queries for the otterstack-specific columns we layered
 * onto better-auth's `organization` table. The auth flow continues to own
 * id/name/slug/logo/metadata/createdAt — these helpers only touch the
 * columns we added (baseDomain + verification + Cloudflare).
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@otterstack/db";
import { organization } from "@otterstack/db/schema/auth";
import { type Id, ID_PREFIX } from "@otterstack/shared/id";

type OrgId = Id<typeof ID_PREFIX.organization>;

export async function getOrganizationById(orgId: OrgId) {
  const [row] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  return row;
}

/**
 * Set (or clear) the org-level base domain. Setting a NEW value resets
 * verification state and rotates the verify token — the prior token
 * shouldn't be honored for a different domain. Clearing (empty string)
 * wipes verification and the token.
 */
export async function setOrganizationBaseDomain(
  orgId: OrgId,
  baseDomain: string,
) {
  const trimmed = baseDomain.trim().toLowerCase();
  const isClear = trimmed.length === 0;
  const existing = await getOrganizationById(orgId);
  // Skip the rotation when the value is unchanged — keeps a verified
  // domain verified across no-op saves from the UI.
  const unchanged =
    !isClear &&
    existing?.baseDomain != null &&
    existing.baseDomain.toLowerCase() === trimmed;
  if (unchanged) return existing;

  const [row] = await db
    .update(organization)
    .set({
      baseDomain: isClear ? null : trimmed,
      baseDomainVerifiedAt: null,
      baseDomainVerifyToken: isClear ? null : randomBytes(16).toString("hex"),
    })
    .where(eq(organization.id, orgId))
    .returning();
  return row;
}

/** Stamp the org's base domain as verified. Caller is responsible for
 *  having already proved the TXT record exists. */
export async function markOrganizationBaseDomainVerified(orgId: OrgId) {
  const [row] = await db
    .update(organization)
    .set({ baseDomainVerifiedAt: new Date() })
    .where(eq(organization.id, orgId))
    .returning();
  return row;
}

/** Store or clear the Cloudflare API token + zone for an org. Passing
 *  `null` for token wipes both (token without zone is useless). */
export async function setOrganizationCloudflareConfig(input: {
  orgId: OrgId;
  apiToken: string | null;
  zoneId: string | null;
}) {
  const [row] = await db
    .update(organization)
    .set({
      cloudflareApiToken: input.apiToken,
      cloudflareZoneId: input.apiToken == null ? null : input.zoneId,
    })
    .where(eq(organization.id, input.orgId))
    .returning();
  return row;
}
