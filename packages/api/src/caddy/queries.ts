import type { PreviewId, ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, asc, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { createError } from "evlog";

import { publishRouteRemoved, publishRouteUpserted } from "../routers/project/project-event-bus";
export type ProxyRouteRecord = InferSelectModel<typeof proxyRoute>;

// "Enabled" for rendering purposes is two gates: the system one (`enabled`,
// recomputed from DNS/exposure verification) AND the operator's explicit
// switch (`disabledByUser`). A route the user paused stays out of Caddy even
// though the system considers it servable.
export async function listEnabledProxyRoutes(): Promise<ProxyRouteRecord[]> {
  return db
    .select()
    .from(proxyRoute)
    .where(and(eq(proxyRoute.enabled, true), eq(proxyRoute.disabledByUser, false)))
    .orderBy(asc(proxyRoute.projectId), asc(proxyRoute.domain));
}

/**
 * Enabled routes paired with the server their resource is pinned to.
 *
 * A LEFT join, not an inner one: routes exist whose resourceId is null (the
 * control-plane route is synthesized, compose-stack members can outlive a
 * resource row mid-reconcile). An inner join would silently drop those from
 * every node's config AND from the count the operator sees. The worst kind of
 * missing route, because nothing anywhere reports it.
 */
export async function listEnabledRoutePlacements(): Promise<
  { routeId: ProxyRouteId; domain: string; placementServerId: string | null }[]
> {
  const rows = await db
    .select({
      routeId: proxyRoute.id,
      domain: proxyRoute.domain,
      placementServerId: resource.placementServerId,
    })
    .from(proxyRoute)
    .leftJoin(resource, eq(proxyRoute.resourceId, resource.id))
    .where(and(eq(proxyRoute.enabled, true), eq(proxyRoute.disabledByUser, false)));
  return rows.map((r) => ({ ...r, placementServerId: r.placementServerId ?? null }));
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
    .where(and(eq(proxyRoute.resourceId, resourceId), isNull(proxyRoute.previewId)))
    .limit(1);
  return record;
}

/** All BASE routes attached to a resource (preview-scoped routes are
 *  excluded: they're lifecycle-managed by the PR webhook, not the
 *  domains card). A service can publish on several hosts now, so callers
 *  that manage the domain set (list/expose/unexpose) read every route, not
 *  just the first. Primary route sorts first. */
export async function listProxyRoutesByResourceId(
  resourceId: ResourceId,
): Promise<ProxyRouteRecord[]> {
  return db
    .select()
    .from(proxyRoute)
    .where(and(eq(proxyRoute.resourceId, resourceId), isNull(proxyRoute.previewId)))
    .orderBy(desc(proxyRoute.isPrimary), asc(proxyRoute.domain));
}

/** The preview-scoped routes of a PR preview (one per exposed service). */
export async function listProxyRoutesByPreview(previewId: PreviewId): Promise<ProxyRouteRecord[]> {
  return db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.previewId, previewId))
    .orderBy(asc(proxyRoute.domain));
}

export async function deleteProxyRoutesByPreview(previewId: PreviewId): Promise<void> {
  await db.delete(proxyRoute).where(eq(proxyRoute.previewId, previewId));
}

export async function getProxyRouteById(id: ProxyRouteId): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db.select().from(proxyRoute).where(eq(proxyRoute.id, id)).limit(1);
  return record;
}

export async function insertProxyRoute(input: {
  projectId: ProjectId;
  resourceId?: ResourceId;
  /** Present only on preview-scoped routes; see the schema comment. */
  previewId?: PreviewId;
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
  domainVerifyToken?: string | null;
  domainVerifiedAt?: Date | null;
}): Promise<ProxyRouteRecord> {
  const [record] = await db
    .insert(proxyRoute)
    .values({
      projectId: input.projectId,
      resourceId: input.resourceId ?? null,
      previewId: input.previewId ?? null,
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
      domainVerifyToken: input.domainVerifyToken ?? null,
      domainVerifiedAt: input.domainVerifiedAt ?? null,
    })
    .returning();

  if (!record) {
    throw createError({
      message: "Failed to insert proxy route",
      status: 500,
      why: "Database insert returned no row for the proxy route",
    });
  }

  publishRouteUpserted("created", record);
  return record;
}

export async function updateProxyRoute(
  id: ProxyRouteId,
  input: Partial<{
    domain: string;
    upstreamHost: string;
    upstreamPort: number;
    enabled: boolean;
    disabledByUser: boolean;
    protected: boolean;
    usesAcme: boolean;
    isPrimary: boolean;
    source: "generated" | "custom";
    dnsState: "pointed" | "proxied" | "unpointed" | "unknown";
    dnsCheckedAt: Date | null;
    routePolicy: ProxyRouteRecord["routePolicy"];
    domainVerifyToken: string | null;
    domainVerifiedAt: Date | null;
    accessPinHash: string | null;
  }>,
): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .update(proxyRoute)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(proxyRoute.id, id))
    .returning();

  // The Networking view has no poll; without this a change made anywhere but
  // the current tab stays invisible until something else invalidates.
  if (record) publishRouteUpserted("updated", record);
  return record;
}

/** Announce removed rows. Unlike an upsert there is no row to carry, so each
 *  delete is announced by key: the client drops exactly those. Rows come from
 *  `.returning()` on the schema columns, so the ids arrive already branded. */
function publishRemovedRows(
  rows: Array<{ id: ProxyRouteId; projectId: ProjectId; resourceId: ResourceId | null }>,
): void {
  for (const row of rows) {
    publishRouteRemoved(row.projectId, row.id, row.resourceId);
  }
}

/** Clear the primary flag on every route of a resource. Used before
 *  promoting a new primary so the (resourceId, isPrimary=true) invariant
 *  stays at most one. */
export async function clearPrimaryForResource(resourceId: ResourceId): Promise<void> {
  const rows = await db
    .update(proxyRoute)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(
      and(
        eq(proxyRoute.resourceId, resourceId),
        eq(proxyRoute.isPrimary, true),
        isNull(proxyRoute.previewId),
      ),
    )
    .returning();
  for (const row of rows) publishRouteUpserted("updated", row);
}

/** Flip the live state of every route on a resource. expose enables them;
 *  unexpose disables them: without deleting the rows, so custom domains
 *  and their guests survive the round-trip. (Add-and-go: a custom host is
 *  live as soon as it's added; whether its cert is real vs self-signed is
 *  the separate `usesAcme`/`dnsState` axis, not `enabled`.) */
export async function setRoutesEnabledForResource(
  resourceId: ResourceId,
  enabled: boolean,
): Promise<void> {
  const rows = await db
    .update(proxyRoute)
    .set({ enabled, updatedAt: new Date() })
    .where(
      and(
        eq(proxyRoute.resourceId, resourceId),
        isNull(proxyRoute.previewId),
        enabled
          ? or(eq(proxyRoute.source, "generated"), isNotNull(proxyRoute.domainVerifiedAt))
          : undefined,
      ),
    )
    .returning();
  for (const row of rows) publishRouteUpserted("updated", row);
}

export async function deleteProxyRoute(id: ProxyRouteId): Promise<void> {
  const rows = await db.delete(proxyRoute).where(eq(proxyRoute.id, id)).returning({
    id: proxyRoute.id,
    projectId: proxyRoute.projectId,
    resourceId: proxyRoute.resourceId,
  });
  publishRemovedRows(rows);
}

export async function deleteProxyRoutesByResource(resourceId: ResourceId): Promise<void> {
  const rows = await db.delete(proxyRoute).where(eq(proxyRoute.resourceId, resourceId)).returning({
    id: proxyRoute.id,
    projectId: proxyRoute.projectId,
    resourceId: proxyRoute.resourceId,
  });
  publishRemovedRows(rows);
}
