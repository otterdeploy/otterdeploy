/**
 * Keep a service's public routes pointed at the port it listens on.
 *
 * A proxy route stores its upstream port when it is written (expose, a domain
 * add, the generated host). The service's ports can change afterwards: the
 * Settings tab, a manifest apply, a build that carries a new port. Before this
 * helper only `exposeService` re-read the primary port, so a live, exposed
 * service whose port moved from 3000 to 8080 rolled onto 8080 while Caddy kept
 * dialing :3000 until someone re-ran expose.
 */
import type { ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { listProxyRoutesByResourceId, updateProxyRoute } from "../../caddy/queries";

/**
 * Point every base http route of `resourceId` at `upstreamPort` (and, when
 * given, `upstreamHost`). Returns the ids of the routes it changed, so the
 * caller can queue the edge reload for exactly those. Layer-4 routes front a
 * port of their own and are left alone; so are preview routes, which belong to
 * the preview's own rollout.
 */
export async function pointRoutesAtPort(
  resourceId: ResourceId,
  upstream: { port: number; host?: string },
): Promise<ProxyRouteId[]> {
  const changed: ProxyRouteId[] = [];
  for (const route of await listProxyRoutesByResourceId(resourceId)) {
    if (route.type !== "http") continue;
    const host = upstream.host ?? route.upstreamHost;
    if (route.upstreamPort === upstream.port && route.upstreamHost === host) continue;
    await updateProxyRoute(route.id, { upstreamPort: upstream.port, upstreamHost: host });
    changed.push(route.id);
  }
  return changed;
}
