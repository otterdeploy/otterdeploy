/**
 * Organization-row queries for the otterdeploy-specific columns we layered
 * onto better-auth's `organization` table. The auth flow continues to own
 * id/name/slug/logo/metadata/createdAt: these helpers only touch the
 * columns we added (baseDomain + verification + Cloudflare).
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { organization } from "@otterdeploy/db/schema/auth";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { project } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { env } from "@otterdeploy/env/server";
import { and, asc, count, eq, like } from "drizzle-orm";
import { randomBytes } from "node:crypto";
type OrgId = OrganizationId;

export async function getOrganizationById(orgId: OrgId) {
  const [row] = await db.select().from(organization).where(eq(organization.id, orgId)).limit(1);
  return row;
}

/**
 * Set (or clear) the org-level base domain. Setting a NEW value resets
 * verification state and rotates the verify token: the prior token
 * shouldn't be honored for a different domain. Clearing (empty string)
 * wipes verification and the token.
 */
export async function setOrganizationBaseDomain(orgId: OrgId, baseDomain: string) {
  const trimmed = baseDomain.trim().toLowerCase();
  const isClear = trimmed.length === 0;
  const existing = await getOrganizationById(orgId);
  // Skip the rotation when the value is unchanged. Keeps a verified
  // domain verified across no-op saves from the UI.
  const unchanged =
    !isClear && existing?.baseDomain != null && existing.baseDomain.toLowerCase() === trimmed;
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

/** The install's public IP (platform settings), or null when unknown. */
export async function readPlatformServerIp(): Promise<string | null> {
  const [settings] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return settings?.serverIp ?? null;
}

/** Dev-only local wildcard (resolver level 4); null outside development, the
 *  same gate as lib/domain-sources.ts. */
export function readLocalBaseDomain(): string | null {
  return env.NODE_ENV === "development" ? (env.LOCAL_BASE_DOMAIN ?? null) : null;
}

/** Escape LIKE's own wildcards so a domain is matched literally. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Generated hostnames this org already serves under `baseDomain`.
 *
 * Each `proxy_route.domain` is minted once, at expose time, and nothing
 * rewrites it when the base domain changes. These are the hosts a domain
 * change leaves exactly where they are, which is what the change dialog lists.
 */
export async function listGeneratedHostnamesUnder(
  orgId: OrgId,
  baseDomain: string,
  limit: number,
): Promise<{ hostnames: string[]; total: number }> {
  const where = and(
    eq(project.organizationId, orgId),
    eq(proxyRoute.source, "generated"),
    // Serving now. A disabled route is not "already exposed": exposing that
    // service again mints a fresh host under whatever the base domain is then.
    eq(proxyRoute.enabled, true),
    like(proxyRoute.domain, `%.${likeLiteral(baseDomain.toLowerCase())}`),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ domain: proxyRoute.domain })
      .from(proxyRoute)
      .innerJoin(project, eq(project.id, proxyRoute.projectId))
      .where(where)
      .orderBy(asc(proxyRoute.domain))
      .limit(limit),
    db
      .select({ n: count() })
      .from(proxyRoute)
      .innerJoin(project, eq(project.id, proxyRoute.projectId))
      .where(where),
  ]);
  return { hostnames: rows.map((r) => r.domain), total: total?.n ?? 0 };
}
