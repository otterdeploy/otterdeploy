/**
 * Public-key → site resolution for the collect path, behind a short
 * in-process TTL cache (docs/designs/web-analytics.md §2: "60 s cache TTL at
 * most" is the bound on how long a rotated key keeps being accepted).
 *
 * Unknown keys are negatively cached for 10 s so a flood of bogus keys costs
 * one query per key per 10 s, not one per request.
 *
 * Allowed hosts = the project's proxy-route domains ∪ `extra_hosts`, all
 * normalized. An EMPTY allowlist means "allow any host": a fresh project has
 * no domains yet and the Setup checklist needs the first event to land so it
 * can say "snippet verified"; once a domain exists the allowlist bites.
 */

import type { AnalyticsSiteRow } from "@otterdeploy/db/schema/analytics";

import { db } from "@otterdeploy/db";
import { analyticsSite } from "@otterdeploy/db/schema/analytics";
import { eq } from "drizzle-orm";

import { normalizeHost } from "../edge-logs/host";
import { listProjectDomains } from "../routers/edge-logs/queries";
import { compileExcludePaths } from "./enrich";

export const SITE_CACHE_TTL_MS = 60_000;
export const SITE_NEGATIVE_TTL_MS = 10_000;

export interface SiteContext {
  site: AnalyticsSiteRow;
  /** Normalized hosts allowed to send events; empty ⇒ any host. */
  allowedHosts: Set<string>;
  /** Compiled `exclude_paths` globs; null when the site has none. */
  excludePathRe: RegExp | null;
}

interface CacheEntry {
  value: SiteContext | null;
  expiresAt: number;
}

declare global {
  var __analyticsSiteCache: Map<string, CacheEntry> | undefined;
}

function cache(): Map<string, CacheEntry> {
  globalThis.__analyticsSiteCache ??= new Map();
  return globalThis.__analyticsSiteCache;
}

async function loadSite(publicKey: string): Promise<SiteContext | null> {
  const [site] = await db
    .select()
    .from(analyticsSite)
    .where(eq(analyticsSite.publicKey, publicKey))
    .limit(1);
  if (!site) return null;
  const routes = await listProjectDomains(site.organizationId, site.projectId);
  const allowedHosts = new Set<string>();
  for (const host of routes) allowedHosts.add(normalizeHost(host));
  for (const host of site.extraHosts) {
    const normalized = normalizeHost(host);
    if (normalized) allowedHosts.add(normalized);
  }
  return { site, allowedHosts, excludePathRe: compileExcludePaths(site.excludePaths) };
}

/** Resolve a tracking key to its site context, or null when unknown. */
export async function resolveSiteByKey(
  publicKey: string,
  now: number = Date.now(),
): Promise<SiteContext | null> {
  const hit = cache().get(publicKey);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await loadSite(publicKey);
  cache().set(publicKey, {
    value,
    expiresAt: now + (value ? SITE_CACHE_TTL_MS : SITE_NEGATIVE_TTL_MS),
  });
  return value;
}

/** Drop one key (after a rotate / settings change) or the whole cache. */
export function invalidateSiteCache(publicKey?: string): void {
  if (publicKey === undefined) cache().clear();
  else cache().delete(publicKey);
}
