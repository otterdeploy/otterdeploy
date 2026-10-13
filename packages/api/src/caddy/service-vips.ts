/**
 * Routes to services the otterd runtime runs dial the service's stable
 * address instead of its Docker name: there is no Swarm DNS to resolve the
 * name, and the address keeps working while backends move between nodes.
 * The address comes only from the scheduler's own rows, never from input.
 */
import { db } from "@otterdeploy/db";
import { otterdService } from "@otterdeploy/db/schema/otterd";
import { and, inArray, isNotNull } from "drizzle-orm";

import type { ProxyRouteInput } from "./types";

export async function withServiceVips(routes: ProxyRouteInput[]): Promise<ProxyRouteInput[]> {
  const hosts = [...new Set(routes.filter((r) => r.type === "http").map((r) => r.upstreamHost))];
  if (hosts.length === 0) return routes;
  const rows = await db
    .select({ serviceName: otterdService.serviceName, vipAddress: otterdService.vipAddress })
    .from(otterdService)
    .where(and(inArray(otterdService.serviceName, hosts), isNotNull(otterdService.vipAddress)));
  const vips = new Map(
    rows.flatMap((r) => (r.serviceName && r.vipAddress ? [[r.serviceName, r.vipAddress]] : [])),
  );
  return routes.map((r) => {
    const vip = r.type === "http" ? vips.get(r.upstreamHost) : undefined;
    return vip ? { ...r, upstreamVip: vip } : r;
  });
}
