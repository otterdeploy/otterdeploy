/**
 * Which base route is a resource's primary (its canonical host, mirrored into
 * serviceResource.publicDomain and exported as PUBLIC_URL/DOMAIN).
 *
 * Exactly one route per resource carries the flag, and two writers deciding
 * it at once used to break that: two `domains.add` calls on a service with
 * no domain both read "no routes yet" and both inserted a primary. Every
 * writer of the flag now runs here, in a transaction that first locks the
 * resource row, so they take turns; the partial unique index
 * `proxy_route_one_primary_per_resource` is the backstop.
 */
import type { ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, eq, isNull, ne } from "drizzle-orm";

import { publishRouteUpserted } from "../routers/project/project-event-bus";
import {
  insertProxyRoute,
  type ProxyRouteInsert,
  type ProxyRouteRecord,
  type RouteTx,
  writeProxyRoute,
} from "./queries";

/** Queue behind any other writer of this resource's primary flag. Never from
 *  the query cache: a cached read takes no lock. */
async function lockResourceRoutes(tx: RouteTx, resourceId: ResourceId): Promise<void> {
  await tx
    .select({ id: resource.id })
    .from(resource)
    .where(eq(resource.id, resourceId))
    .for("no key update")
    .$withCache(false);
}

/** The resource's base routes that carry the primary flag. */
function primaryRouteFilter(resourceId: ResourceId) {
  return and(
    eq(proxyRoute.resourceId, resourceId),
    isNull(proxyRoute.previewId),
    eq(proxyRoute.isPrimary, true),
  );
}

/**
 * Insert a base route of a resource; it becomes the primary exactly when the
 * resource has none yet (the first host is the one everything else mirrors).
 */
export async function insertResourceRoute(
  input: Omit<ProxyRouteInsert, "isPrimary" | "previewId"> & { resourceId: ResourceId },
): Promise<ProxyRouteRecord> {
  return insertProxyRoute(input, async (tx) => {
    await lockResourceRoutes(tx, input.resourceId);
    const [primary] = await tx
      .select({ id: proxyRoute.id })
      .from(proxyRoute)
      .where(primaryRouteFilter(input.resourceId))
      .limit(1)
      .$withCache(false);
    return writeProxyRoute(tx, { ...input, isPrimary: primary === undefined });
  });
}

/**
 * Make `routeId` the resource's primary: the old one is cleared first, in the
 * same transaction, so there is never a moment with two. Undefined when the
 * route is not a base route of this resource.
 */
export async function promotePrimaryRoute(
  resourceId: ResourceId,
  routeId: ProxyRouteId,
): Promise<ProxyRouteRecord | undefined> {
  const changed = await db.transaction(async (tx) => {
    await lockResourceRoutes(tx, resourceId);
    const [target] = await tx
      .select({ id: proxyRoute.id })
      .from(proxyRoute)
      .where(
        and(
          eq(proxyRoute.id, routeId),
          eq(proxyRoute.resourceId, resourceId),
          isNull(proxyRoute.previewId),
        ),
      )
      .limit(1)
      .$withCache(false);
    // A route that is not this resource's must not leave it with no primary.
    if (!target) return null;
    const cleared = await tx
      .update(proxyRoute)
      .set({ isPrimary: false })
      .where(and(primaryRouteFilter(resourceId), ne(proxyRoute.id, routeId)))
      .returning();
    const [promoted] = await tx
      .update(proxyRoute)
      .set({ isPrimary: true })
      .where(eq(proxyRoute.id, routeId))
      .returning();
    return promoted ? { cleared, promoted } : null;
  });
  if (!changed) return undefined;
  for (const row of [...changed.cleared, changed.promoted]) publishRouteUpserted("updated", row);
  return changed.promoted;
}
