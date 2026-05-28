/**
 * Loader for the DomainSources record consumed by `resolvePublicDomain`.
 * One round-trip: joins the project to its org and to the singleton
 * platform_settings row so the resolver has everything it needs without
 * the caller passing pieces in.
 *
 * If you find yourself reaching for `getProjectInOrg` + `getOrgById` +
 * `getPlatformSettings` separately when building a hostname, you almost
 * certainly want this instead.
 */

import { eq } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { organization } from "@otterdeploy/db/schema/auth";
import {
  PLATFORM_SETTINGS_ID,
  platformSettings,
} from "@otterdeploy/db/schema/platform";
import { project } from "@otterdeploy/db/schema/project";
import { type Id, ID_PREFIX } from "@otterdeploy/shared/id";

import type { DomainSources } from "./domains";

export async function loadDomainSourcesForProject(
  projectId: Id<typeof ID_PREFIX.project>,
): Promise<DomainSources | null> {
  const [row] = await db
    .select({
      projectCustomDomain: project.customDomain,
      projectCustomDomainVerifiedAt: project.customDomainVerifiedAt,
      orgBaseDomain: organization.baseDomain,
      orgBaseDomainVerifiedAt: organization.baseDomainVerifiedAt,
    })
    .from(project)
    .innerJoin(organization, eq(organization.id, project.organizationId))
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row) return null;

  const [settings] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);

  return {
    resourceOverride: null, // caller fills in per-resource override
    projectCustomDomain: row.projectCustomDomain,
    projectCustomDomainVerifiedAt: row.projectCustomDomainVerifiedAt,
    orgBaseDomain: row.orgBaseDomain,
    orgBaseDomainVerifiedAt: row.orgBaseDomainVerifiedAt,
    serverIp: settings?.serverIp ?? null,
  };
}
