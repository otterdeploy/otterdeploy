import { asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterstack/db";
import { proxyRoute } from "@otterstack/db/schema/proxy-route";

export type ProxyRouteRecord = InferSelectModel<typeof proxyRoute>;

export async function listEnabledProxyRoutes(): Promise<ProxyRouteRecord[]> {
  return db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.enabled, true))
    .orderBy(asc(proxyRoute.projectId), asc(proxyRoute.domain));
}

export async function listProxyRoutesByProject(projectId: string): Promise<ProxyRouteRecord[]> {
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

export async function getProxyRouteByResourceId(resourceId: string): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.resourceId, resourceId))
    .limit(1);
  return record;
}

export async function insertProxyRoute(input: {
  projectId: string;
  resourceId?: string;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn?: string;
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
    })
    .returning();

  if (!record) {
    throw new Error("Failed to insert proxy route.");
  }

  return record;
}

export async function updateProxyRoute(
  id: string,
  input: Partial<{
    upstreamHost: string;
    upstreamPort: number;
    enabled: boolean;
  }>,
): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .update(proxyRoute)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(proxyRoute.id, id))
    .returning();

  return record;
}

export async function deleteProxyRoute(id: string): Promise<void> {
  await db.delete(proxyRoute).where(eq(proxyRoute.id, id));
}

export async function deleteProxyRoutesByResource(resourceId: string): Promise<void> {
  await db.delete(proxyRoute).where(eq(proxyRoute.resourceId, resourceId));
}
