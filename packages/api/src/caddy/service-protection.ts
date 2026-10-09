/**
 * Deployment protection is per SERVICE, not per host: the reads
 * the edge and the authorizer use to treat every route of a resource as one
 * protected unit, beside the private-environment floor, and the write that
 * sets a protection field on every one of them.
 */
import type { ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, resource } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { type ProxyRouteRecord, updateProxyRoute } from "./queries";

/**
 * Route ids whose owning ENVIRONMENT is private.
 *
 * The floor is declared on the environment, but the edge renders ROUTES, so it
 * has to be resolved into route identity before the Caddyfile is built. Two
 * hops get there: a route names a resource, a resource names an environment.
 *
 * An INNER join, deliberately the opposite choice from listEnabledRoutePlacements
 * above. There a missing resource meant a route silently vanishing from the
 * config, which is a bug. Here a route with no resource - the synthesized
 * control-plane route, a compose member mid-reconcile - belongs to no
 * environment and so inherits no floor. Dropping it is the answer, not a hole.
 */
async function protectedEnvironmentRouteIds(): Promise<Set<ProxyRouteId>> {
  const rows = await db
    .select({ routeId: proxyRoute.id })
    .from(proxyRoute)
    .innerJoin(resource, eq(proxyRoute.resourceId, resource.id))
    .innerJoin(environment, eq(resource.environmentId, environment.id))
    .where(eq(environment.protected, true));
  return new Set(rows.map((r) => r.routeId));
}

/**
 * Route ids that inherit protection from their SERVICE: every route of a
 * resource where any one route is protected.
 *
 * Protection is per service, not per host. The settings card has one switch,
 * bound to whichever of the service's routes it found first, so with a custom
 * domain and a generated host the other host stayed public: a way around the
 * login wall through the service's second name. The write path sets every
 * route of the resource together; this floor covers the routes that arrive
 * after it (a newly generated host, a preview route) so none of them opens a
 * gap before anything rewrites its own column.
 */
async function protectedServiceRouteIds(): Promise<Set<ProxyRouteId>> {
  const protectedResources = db
    .select({ resourceId: proxyRoute.resourceId })
    .from(proxyRoute)
    .where(and(eq(proxyRoute.protected, true), isNotNull(proxyRoute.resourceId)));
  const rows = await db
    .select({ routeId: proxyRoute.id })
    .from(proxyRoute)
    .where(inArray(proxyRoute.resourceId, protectedResources));
  return new Set(rows.map((r) => r.routeId));
}

/** Every route the edge must gate beyond its own `protected` column: the
 *  private-environment floor and the per-service floor, in one set so all
 *  three render paths stay identical. */
export async function protectionFloorRouteIds(): Promise<Set<ProxyRouteId>> {
  const [byEnvironment, byService] = await Promise.all([
    protectedEnvironmentRouteIds(),
    protectedServiceRouteIds(),
  ]);
  return new Set([...byEnvironment, ...byService]);
}

/** Every route of the service `route` belongs to, itself included, previews
 *  too. A route with no resource (the control-plane route) is its own
 *  service. Protection settings are written across this set together. */
export async function serviceRoutesOf(route: {
  id: ProxyRouteId;
  resourceId: ResourceId | null;
}): Promise<ProxyRouteRecord[]> {
  if (!route.resourceId) {
    return db.select().from(proxyRoute).where(eq(proxyRoute.id, route.id));
  }
  return db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.resourceId, route.resourceId))
    .orderBy(asc(proxyRoute.createdAt));
}

/** The ids of {@link serviceRoutesOf}. */
export async function serviceRouteIdsOf(route: {
  id: ProxyRouteId;
  resourceId: ResourceId | null;
}): Promise<ProxyRouteId[]> {
  return (await serviceRoutesOf(route)).map((r) => r.id);
}

/** Write a protection field to every OTHER route of `route`'s service; the
 *  caller writes the addressed route itself and answers with that row. */
export async function updateServiceSiblings(
  route: { id: ProxyRouteId; resourceId: ResourceId | null },
  patch: { protected: boolean } | { accessPinHash: string | null },
): Promise<void> {
  for (const sibling of await serviceRoutesOf(route)) {
    if (sibling.id !== route.id) await updateProxyRoute(sibling.id, patch);
  }
}
