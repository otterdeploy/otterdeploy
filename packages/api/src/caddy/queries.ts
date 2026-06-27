import type { ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, asc, desc, eq } from "drizzle-orm";
import { isNotNull } from "drizzle-orm";
import { createError } from "evlog";
export type ProxyRouteRecord = InferSelectModel<typeof proxyRoute>;

/** Every project that has operator-authored custom Caddy config, as a
 *  projectId → config map. Drives the reconciler's per-project standalone
 *  blocks (a project can have custom config even with no routes). */
export async function getProjectsWithCustomConfig(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: project.id, config: project.customCaddyConfig })
    .from(project)
    .where(isNotNull(project.customCaddyConfig));
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.config && r.config.trim().length > 0) map.set(r.id, r.config);
  }
  return map;
}

/** A single project's custom Caddy config (for the read-only viewer render). */
export async function getProjectCustomConfig(projectId: ProjectId): Promise<string | null> {
  const [row] = await db
    .select({ config: project.customCaddyConfig })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  return row?.config ?? null;
}

/** Persist a project's custom Caddy config (null clears it). */
export async function setProjectCustomConfig(
  projectId: ProjectId,
  config: string | null,
): Promise<void> {
  await db
    .update(project)
    .set({ customCaddyConfig: config, updatedAt: new Date() })
    .where(eq(project.id, projectId));
}

export async function listEnabledProxyRoutes(): Promise<ProxyRouteRecord[]> {
  return db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.enabled, true))
    .orderBy(asc(proxyRoute.projectId), asc(proxyRoute.domain));
}

export async function listProxyRoutesByProject(projectId: ProjectId): Promise<ProxyRouteRecord[]> {
  return db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.projectId, projectId))
    .orderBy(asc(proxyRoute.domain));
}

export async function getProxyRouteByDomain(domain: string): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db.select().from(proxyRoute).where(eq(proxyRoute.domain, domain)).limit(1);
  return record;
}

export async function getProxyRouteByResourceId(
  resourceId: ResourceId,
): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.resourceId, resourceId))
    .limit(1);
  return record;
}

/** All routes attached to a resource. A service can publish on several
 *  hosts now, so callers that manage the domain set (list/expose/unexpose)
 *  read every route, not just the first. Primary route sorts first. */
export async function listProxyRoutesByResourceId(
  resourceId: ResourceId,
): Promise<ProxyRouteRecord[]> {
  return db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.resourceId, resourceId))
    .orderBy(desc(proxyRoute.isPrimary), asc(proxyRoute.domain));
}

export async function getProxyRouteById(id: ProxyRouteId): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db.select().from(proxyRoute).where(eq(proxyRoute.id, id)).limit(1);
  return record;
}

export async function insertProxyRoute(input: {
  projectId: ProjectId;
  resourceId?: ResourceId;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn?: string;
  /** True when Caddy should attempt public ACME issuance for this
   *  domain. Defaults to false (self-signed via tls internal) so an
   *  unowned domain can't accidentally trigger Let's Encrypt rate
   *  limits. Callers pass the resolver outcome's `verified` flag. */
  usesAcme?: boolean;
  /** Whether reconcile renders this route. Defaults true (generated
   *  routes go live immediately); custom routes pass false until their
   *  DNS verification flips them on. */
  enabled?: boolean;
  source?: "generated" | "custom";
  isPrimary?: boolean;
  dnsState?: "pointed" | "proxied" | "unpointed" | "unknown";
  dnsCheckedAt?: Date | null;
}): Promise<ProxyRouteRecord> {
  const [record] = await db
    .insert(proxyRoute)
    .values({
      projectId: input.projectId,
      resourceId: input.resourceId ?? null,
      type: input.type,
      domain: input.domain,
      upstreamHost: input.upstreamHost,
      upstreamPort: input.upstreamPort,
      protocol: input.protocol,
      layer4Alpn: input.layer4Alpn ?? null,
      usesAcme: input.usesAcme ?? false,
      enabled: input.enabled ?? true,
      source: input.source ?? "generated",
      isPrimary: input.isPrimary ?? false,
      dnsState: input.dnsState ?? "unknown",
      dnsCheckedAt: input.dnsCheckedAt ?? null,
    })
    .returning();

  if (!record) {
    throw createError({
      message: "Failed to insert proxy route",
      status: 500,
      why: "Database insert returned no row for the proxy route",
    });
  }

  return record;
}

export async function updateProxyRoute(
  id: ProxyRouteId,
  input: Partial<{
    domain: string;
    upstreamHost: string;
    upstreamPort: number;
    enabled: boolean;
    protected: boolean;
    usesAcme: boolean;
    isPrimary: boolean;
    source: "generated" | "custom";
    dnsState: "pointed" | "proxied" | "unpointed" | "unknown";
    dnsCheckedAt: Date | null;
    customDirectives: string | null;
  }>,
): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .update(proxyRoute)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(proxyRoute.id, id))
    .returning();

  return record;
}

/** Clear the primary flag on every route of a resource. Used before
 *  promoting a new primary so the (resourceId, isPrimary=true) invariant
 *  stays at most one. */
export async function clearPrimaryForResource(resourceId: ResourceId): Promise<void> {
  await db
    .update(proxyRoute)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(and(eq(proxyRoute.resourceId, resourceId), eq(proxyRoute.isPrimary, true)));
}

/** Flip the live state of every route on a resource. expose enables them;
 *  unexpose disables them — without deleting the rows, so custom domains
 *  and their guests survive the round-trip. (Add-and-go: a custom host is
 *  live as soon as it's added; whether its cert is real vs self-signed is
 *  the separate `usesAcme`/`dnsState` axis, not `enabled`.) */
export async function setRoutesEnabledForResource(
  resourceId: ResourceId,
  enabled: boolean,
): Promise<void> {
  await db
    .update(proxyRoute)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(proxyRoute.resourceId, resourceId));
}

export async function deleteProxyRoute(id: ProxyRouteId): Promise<void> {
  await db.delete(proxyRoute).where(eq(proxyRoute.id, id));
}

export async function deleteProxyRoutesByResource(resourceId: ResourceId): Promise<void> {
  await db.delete(proxyRoute).where(eq(proxyRoute.resourceId, resourceId));
}
