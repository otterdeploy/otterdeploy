/**
 * Routes to services and databases the otterd runtime runs dial the stable
 * service address instead of a Docker name: there is no Swarm DNS to
 * resolve the name, and the address keeps working while backends move
 * between nodes. An HTTP route names the service by its runtime name; a
 * layer-4 database route by its internal hostname, which the scheduler's
 * spec carries as an alias. The address comes only from the scheduler's own
 * rows, never from input.
 */
import { db } from "@otterdeploy/db";
import { otterdService, otterdServiceRevision } from "@otterdeploy/db/schema/otterd";
import { serviceSpec } from "@otterdeploy/otterd-proto";
import { and, eq, isNotNull } from "drizzle-orm";

import type { ProxyRouteInput } from "./types";

/** Every name a VIP service answers to → its VIP. */
async function vipNames(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      serviceName: otterdService.serviceName,
      vipAddress: otterdService.vipAddress,
      spec: otterdServiceRevision.spec,
    })
    .from(otterdService)
    .innerJoin(
      otterdServiceRevision,
      and(
        eq(otterdServiceRevision.resourceId, otterdService.resourceId),
        eq(otterdServiceRevision.revision, otterdService.revision),
      ),
    )
    .where(isNotNull(otterdService.vipAddress));
  const names = new Map<string, string>();
  for (const r of rows) {
    if (!r.vipAddress) continue;
    const spec = serviceSpec.safeParse(r.spec);
    const aliases = spec.success ? (spec.data.endpoint.aliases ?? []) : [];
    for (const n of [r.serviceName, ...aliases]) if (n) names.set(n, r.vipAddress);
  }
  return names;
}

export async function withServiceVips(routes: ProxyRouteInput[]): Promise<ProxyRouteInput[]> {
  if (routes.length === 0) return routes;
  const vips = await vipNames();
  if (vips.size === 0) return routes;
  return routes.map((r) => {
    const vip = r.projectId === "control-plane" ? undefined : vips.get(r.upstreamHost);
    return vip ? { ...r, upstreamVip: vip } : r;
  });
}
