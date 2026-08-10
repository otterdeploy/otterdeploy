/**
 * Where a branchable database is allowed to run.
 *
 * Both branch transports reach the database from the control plane's own host:
 *
 *   copy: `pgDumpToBuffer(docker, containerId, …)` is a `docker exec` over the
 *          LOCAL docker socket, which only sees containers on this node.
 *   zfs: `runOnHost` nsenters PID 1 of the machine the control plane runs on,
 *          and the dataset lives wherever the volume is.
 *
 * On the plain-Docker runtime that is trivially satisfied: there is one host.
 * On Swarm a database can be scheduled anywhere, so a database that has opted
 * into preview branching must be PINNED to the control-plane host or neither
 * transport can reach it.
 *
 * The control-plane host is the bootstrap `localhost` server row. By
 * construction the machine the installer ran on, which is also where it ran
 * `docker swarm init` and where it provisioned the ZFS pool. Pinning there puts
 * the database on the machine that already has everything branching needs.
 *
 * This is enforced where the conflict is CREATED. Enabling branching, or
 * moving a database: rather than discovered as a failed branch hours later
 * when someone opens a pull request.
 */
import type { OrganizationId, ResourceId, ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource, server } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";

import { isSwarmRuntime } from "../../runtime";

/** The bootstrap row: the host running otterdeploy itself. */
async function controlPlaneServerId(organizationId: OrganizationId): Promise<ServerId | null> {
  const [row] = await db
    .select({ id: server.id })
    .from(server)
    .where(and(eq(server.organizationId, organizationId), eq(server.host, "127.0.0.1")))
    .limit(1);
  return (row?.id as ServerId | undefined) ?? null;
}

/**
 * Why this placement cannot carry preview branching, or null when it can.
 *
 * Returns a message rather than a boolean because the operator needs to know
 * which of the two things to change (the pin or the branching flag) and a
 * bare "invalid" tells them neither.
 */
export async function branchPlacementConflict(input: {
  organizationId: OrganizationId;
  /** The database's `placementServerId`. Null = unpinned. */
  placementServerId: ServerId | null | undefined;
  /** The database's `previewBranching` flag, as it WOULD be after this change. */
  previewBranching: boolean;
}): Promise<string | null> {
  // Nothing to protect: a database that never branches can live anywhere.
  if (!input.previewBranching) return null;
  // One host, so both transports are local by definition.
  if (!isSwarmRuntime()) return null;

  const controlPlane = await controlPlaneServerId(input.organizationId);
  // No bootstrap row to pin to, refusing here would block the operator with no
  // available fix, so allow it and let the branch fail visibly (Blocked) rather
  // than inventing a constraint they cannot satisfy.
  if (!controlPlane) return null;

  if (!input.placementServerId) {
    return "On Swarm, a database with preview branching must be pinned to the host running otterdeploy. Unpinned it can be scheduled on a node the branch cannot reach. Pin it, or turn preview branching off.";
  }
  if (input.placementServerId !== controlPlane) {
    return "Preview branching only works on the host running otterdeploy: the branch is taken over that machine's Docker socket and filesystem. Move this database there, or turn preview branching off.";
  }
  return null;
}

/**
 * The same check, resolving the resource's own placement. Callers on the
 * manifest-apply path have a resource id but not its pin, and threading one
 * more argument through every apply signature to reach it would be worse than
 * one extra select on a path that already writes.
 */
export async function branchPlacementConflictForResource(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  previewBranching: boolean;
}): Promise<string | null> {
  // Cheap exits first: neither branch of the check below needs the row.
  if (!input.previewBranching || !isSwarmRuntime()) return null;

  const [row] = await db
    .select({ placementServerId: resource.placementServerId })
    .from(resource)
    .where(eq(resource.id, input.resourceId))
    .limit(1);

  return branchPlacementConflict({
    organizationId: input.organizationId,
    placementServerId: row?.placementServerId ?? null,
    previewBranching: input.previewBranching,
  });
}
