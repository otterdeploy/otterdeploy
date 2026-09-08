/**
 * The edge-proxy half of the server row.
 *
 * Its own file because ./queries.ts is at its size cap, and because this
 * answers a question none of the others do: whether this node terminates its
 * own traffic. See ./provision-edge-conflict.ts for what decides it.
 */

import type { OrganizationId as OrgId, ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { server } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";

import type { ServerRecord } from "./queries";

import { publishOrgEvent } from "../project/project-event-bus";

/**
 * Record whether this node terminates its own traffic, and why not when it
 * does not.
 *
 * Separate from `patchServerFirewall` despite the identical shape: they answer
 * different questions and one can succeed while the other does not. Merging
 * them would mean a firewall write silently clearing an edge reason.
 */
export async function patchServerEdgeProxy(input: {
  serverId: ServerId;
  organizationId: OrgId;
  edgeProxyStatus:
    | "unknown"
    | "running"
    | "port_conflict"
    | "platform_present"
    | "failed"
    | "unsupported";
  edgeProxyError?: string | null;
}): Promise<ServerRecord | undefined> {
  const { serverId, organizationId, ...set } = input;
  const [row] = await db
    .update(server)
    .set({
      ...set,
      // A reason only describes a non-running edge. Leaving a stale one behind
      // after a successful re-provision would keep telling the operator about a
      // conflict they already resolved.
      edgeProxyError: input.edgeProxyStatus === "running" ? null : (input.edgeProxyError ?? null),
    })
    .where(and(eq(server.id, serverId), eq(server.organizationId, organizationId)))
    .returning();
  if (row) publishOrgEvent(organizationId, "servers");
  return row;
}
