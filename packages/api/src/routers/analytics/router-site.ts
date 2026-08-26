/**
 * Site-management handlers: lazy site creation, host/path settings, key
 * rotation. Every mutation invalidates the collector's key cache, so a
 * rotated or reconfigured site takes effect within one request, not the
 * cache's 60 s TTL.
 */

import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { resolveCanonicalWebOrigin } from "@otterdeploy/auth/web-origin";
import { db } from "@otterdeploy/db";
import { analyticsSite, type AnalyticsSiteRow } from "@otterdeploy/db/schema/analytics";
import { env } from "@otterdeploy/env/server";
import { omitUndefined } from "@otterdeploy/shared/object";
import { eq, sql } from "drizzle-orm";

import { projectScopedProcedure, requirePermission } from "../..";
import { mintPublicKey } from "../../analytics/keys";
import { ensureSite, getSiteForProject, projectInOrg } from "../../analytics/query/scope";
import { invalidateSiteCache } from "../../analytics/site-cache";
import { collectStats, type CollectStats } from "../../analytics/stats";
import { buildSnippet } from "../../analytics/tracker";
import { normalizeHost } from "../../edge-logs/host";
import { listProjectRoutes } from "../edge-logs/queries";

interface SiteResult {
  site: {
    id: AnalyticsSiteRow["id"];
    projectId: ProjectId;
    publicKey: string;
    keyRotatedAt: string | null;
    extraHosts: string[];
    excludePaths: string[];
    respectDnt: boolean;
    requireConsent: boolean;
    firstEventAt: string | null;
    createdAt: string;
  } | null;
  snippet: string | null;
  allowedHosts: string[];
  stats: CollectStats | null;
}

/** Assemble the shared site.* result: row + snippet + allowlist + counters.
 *  With no site yet, `allowedHosts` still lists the project's route domains
 *  so Setup can show what WILL be accepted after ensure. */
async function siteResult(
  organizationId: OrganizationId,
  projectId: ProjectId,
  site: AnalyticsSiteRow | null,
): Promise<SiteResult> {
  const routes = await listProjectRoutes(organizationId, projectId);
  const routeHosts = routes.map((r) => r.host);
  if (!site) return { site: null, snippet: null, allowedHosts: routeHosts, stats: null };

  const origin = await resolveCanonicalWebOrigin(env.PUBLIC_API_URL ?? env.BETTER_AUTH_URL);
  return {
    site: {
      id: site.id,
      projectId: site.projectId,
      publicKey: site.publicKey,
      keyRotatedAt: site.keyRotatedAt?.toISOString() ?? null,
      extraHosts: site.extraHosts,
      excludePaths: site.excludePaths,
      respectDnt: site.respectDnt,
      requireConsent: site.requireConsent,
      firstEventAt: site.firstEventAt?.toISOString() ?? null,
      createdAt: site.createdAt.toISOString(),
    },
    snippet: buildSnippet(origin, site.publicKey),
    allowedHosts: [...new Set([...routeHosts, ...site.extraHosts])],
    stats: collectStats(site.id),
  };
}

const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** Normalize + dedupe extra hosts; null = something wasn't a hostname. */
function normalizeExtraHosts(hosts: readonly string[]): string[] | null {
  const out = new Set<string>();
  for (const raw of hosts) {
    const host = normalizeHost(raw);
    if (!HOST_RE.test(host) || host.includes("..")) return null;
    out.add(host);
  }
  return [...out];
}

/** Exclude-path globs: absolute, no whitespace. Wildcards are free-form
 *  (`*` handled at collect); the shape check is what keeps them paths. */
function normalizeExcludePaths(paths: readonly string[]): string[] | null {
  const out = new Set<string>();
  for (const raw of paths) {
    const p = raw.trim();
    if (!p.startsWith("/") || /\s/.test(p)) return null;
    out.add(p);
  }
  return [...out];
}

export const analyticsSiteRouter = {
  get: projectScopedProcedure.analytics.site.get.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.projectId } });
    const site = await getSiteForProject(context.activeOrganizationId, input.projectId);
    if (!site && !(await projectInOrg(context.activeOrganizationId, input.projectId))) {
      throw errors.NOT_FOUND();
    }
    return siteResult(context.activeOrganizationId, input.projectId, site);
  }),

  ensure: requirePermission({ project: ["update"] }).analytics.site.ensure.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const site = await ensureSite(context.activeOrganizationId, input.projectId);
      if (!site) throw errors.NOT_FOUND();
      return siteResult(context.activeOrganizationId, input.projectId, site);
    },
  ),

  update: requirePermission({ project: ["update"] }).analytics.site.update.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const site = await getSiteForProject(context.activeOrganizationId, input.projectId);
      if (!site) throw errors.NOT_FOUND();

      const extraHosts =
        input.extraHosts === undefined ? undefined : normalizeExtraHosts(input.extraHosts);
      if (extraHosts === null) {
        throw errors.INVALID_INPUT({ message: "extraHosts must be plain hostnames." });
      }
      const excludePaths =
        input.excludePaths === undefined ? undefined : normalizeExcludePaths(input.excludePaths);
      if (excludePaths === null) {
        throw errors.INVALID_INPUT({
          message: "excludePaths must be absolute path globs like /admin/*.",
        });
      }

      const patch = omitUndefined({
        extraHosts,
        excludePaths,
        respectDnt: input.respectDnt,
        requireConsent: input.requireConsent,
      });
      if (Object.keys(patch).length > 0) {
        await db.update(analyticsSite).set(patch).where(eq(analyticsSite.id, site.id));
        // The collector caches sites by public key for 60 s; settle now.
        invalidateSiteCache(site.publicKey);
      }
      const updated = await getSiteForProject(context.activeOrganizationId, input.projectId);
      return siteResult(context.activeOrganizationId, input.projectId, updated);
    },
  ),

  rotateKey: requirePermission({ project: ["update"] }).analytics.site.rotateKey.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const site = await getSiteForProject(context.activeOrganizationId, input.projectId);
      if (!site) throw errors.NOT_FOUND();

      await db
        .update(analyticsSite)
        .set({ publicKey: mintPublicKey(), keyRotatedAt: sql`now()` })
        .where(eq(analyticsSite.id, site.id));
      // The old key must stop being accepted immediately, not at cache TTL.
      invalidateSiteCache(site.publicKey);
      const rotated = await getSiteForProject(context.activeOrganizationId, input.projectId);
      return siteResult(context.activeOrganizationId, input.projectId, rotated);
    },
  ),
};
