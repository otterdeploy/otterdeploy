/**
 * Site-scope resolution for the analytics query API — the authz seam every
 * read goes through. Mirrors edge-logs' host scoping: install-wide needs the
 * server-owned install:read capability; a projectId is only honoured when the
 * project belongs to the caller's active organization (the org join IS the
 * cross-tenant guard); otherwise the scope is every site of the org (only the
 * selected projects' sites for a key minted for selected projects). An empty
 * scope is returned as an empty list — callers answer with honest zeros,
 * never a 404 and never someone else's data.
 */

import type { AnalyticsSiteId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { analyticsSite, type AnalyticsSiteRow } from "@otterdeploy/db/schema/analytics";
import { project } from "@otterdeploy/db/schema/project";
import { idSchema } from "@otterdeploy/shared/id";
import { and, eq, inArray, min } from "drizzle-orm";

import { type ResolvedActor } from "../../authz/actor";
import { scopedProjectIds } from "../../authz/api-key-scope";
import { authorizeCapability } from "../../authz/capability";
import { mintPublicKey } from "../keys";

export interface SiteScopeInput {
  projectId?: ProjectId;
  installWide?: boolean;
}

export async function resolveSiteScope(
  context: { actor: ResolvedActor; activeOrganizationId: OrganizationId },
  input: SiteScopeInput,
  forbid: (message: string) => never,
): Promise<AnalyticsSiteId[]> {
  if (input.installWide) {
    const decision = await authorizeCapability(context.actor, { scope: "install", mode: "read" });
    if (!decision.allowed) forbid(decision.reason);
    const rows = await db.select({ id: analyticsSite.id }).from(analyticsSite);
    return rows.map((r) => r.id);
  }
  if (input.projectId) {
    const rows = await db
      .select({ id: analyticsSite.id })
      .from(analyticsSite)
      .innerJoin(project, eq(project.id, analyticsSite.projectId))
      .where(
        and(
          eq(analyticsSite.projectId, input.projectId),
          eq(project.organizationId, context.activeOrganizationId),
        ),
      );
    return rows.map((r) => r.id);
  }
  // No project named: every site of the org, narrowed to a project-scoped
  // key's own projects. An empty allow-list is an empty scope, answered
  // with honest zeros like any other.
  const allowed = scopedProjectIds(
    context.actor?.kind === "api-key" ? context.actor : null,
  )?.flatMap((projectId) => {
    const parsed = idSchema.project.safeParse(projectId);
    return parsed.success ? [parsed.data] : [];
  });
  if (allowed && allowed.length === 0) return [];
  const rows = await db
    .select({ id: analyticsSite.id })
    .from(analyticsSite)
    .where(
      and(
        eq(analyticsSite.organizationId, context.activeOrganizationId),
        allowed ? inArray(analyticsSite.projectId, allowed) : undefined,
      ),
    );
  return rows.map((r) => r.id);
}

/** Earliest site creation (epoch ms) in the scope: the honest lower bound of
 *  an `all` window (no data can precede its site). Null for an empty scope. */
export async function earliestSiteCreatedAt(
  siteIds: readonly AnalyticsSiteId[],
): Promise<number | null> {
  if (siteIds.length === 0) return null;
  const rows = await db
    .select({ earliest: min(analyticsSite.createdAt) })
    .from(analyticsSite)
    .where(inArray(analyticsSite.id, [...siteIds]));
  const earliest = rows[0]?.earliest ?? null;
  // Drizzle hands back a Date at this seam; take its epoch ms immediately.
  return earliest === null ? null : earliest.getTime();
}

/** The project's site, org-guarded; null = no site yet OR not your project
 *  (indistinguishable on purpose — same as an empty scope). */
export async function getSiteForProject(
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<AnalyticsSiteRow | null> {
  const rows = await db
    .select({ site: analyticsSite })
    .from(analyticsSite)
    .innerJoin(project, eq(project.id, analyticsSite.projectId))
    .where(and(eq(analyticsSite.projectId, projectId), eq(project.organizationId, organizationId)))
    .limit(1);
  return rows[0]?.site ?? null;
}

/** Cross-tenant guard shared by the site handlers. */
export async function projectInOrg(
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<boolean> {
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Create the project's site lazily (first Setup open), minting a public key.
 * Insert-if-missing guarded against the `analytics_site_project_unique`
 * index with onConflictDoNothing + reselect, so two concurrent ensures
 * converge on one row. Null when the project isn't in the caller's org.
 */
export async function ensureSite(
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<AnalyticsSiteRow | null> {
  if (!(await projectInOrg(organizationId, projectId))) return null;

  const existing = await getSiteForProject(organizationId, projectId);
  if (existing) return existing;

  await db
    .insert(analyticsSite)
    .values({ projectId, organizationId, publicKey: mintPublicKey() })
    .onConflictDoNothing({ target: analyticsSite.projectId });
  return getSiteForProject(organizationId, projectId);
}
