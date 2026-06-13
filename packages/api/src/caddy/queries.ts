
import type { ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";
import { asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { createError } from "evlog";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
export type ProxyRouteRecord = InferSelectModel<typeof proxyRoute>;

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
  const [record] = await db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.domain, domain))
    .limit(1);
  return record;
}

export async function getProxyRouteByResourceId(resourceId: ResourceId): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.resourceId, resourceId))
    .limit(1);
  return record;
}

export async function getProxyRouteById(id: ProxyRouteId): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.id, id))
    .limit(1);
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
    upstreamHost: string;
    upstreamPort: number;
    enabled: boolean;
    protected: boolean;
  }>,
): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .update(proxyRoute)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(proxyRoute.id, id))
    .returning();

  return record;
}

export async function deleteProxyRoute(id: ProxyRouteId): Promise<void> {
  await db.delete(proxyRoute).where(eq(proxyRoute.id, id));
}

export async function deleteProxyRoutesByResource(resourceId: ResourceId): Promise<void> {
  await db.delete(proxyRoute).where(eq(proxyRoute.resourceId, resourceId));
}
