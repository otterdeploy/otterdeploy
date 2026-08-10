/**
 * Turn a resource's `placementServerId` into a swarm node id at deploy time.
 *
 * Deliberately does no work when the resource is unpinned. The common case
 * costs zero docker calls.
 *
 * What happens when a pin can't be resolved differs by what the resource
 * holds, and the difference matters more than it looks:
 *
 *   - A STATELESS service pinned to a missing node is better off running
 *     somewhere than nowhere. Deploy unpinned, and tell the operator.
 *   - A DATABASE pinned to a missing node must NOT deploy unpinned. Its volume
 *     is local to the old node; starting it elsewhere gives it a brand-new
 *     empty one, and an empty database is indistinguishable from a destroyed
 *     database to the person looking at it. Fail the deploy instead.
 *
 * Hence two entry points over one resolution.
 */

import type { OrganizationId, ProjectId, ResourceId, ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema";
import { Docker } from "@otterdeploy/docker";
import { eq } from "drizzle-orm";

import { getServerInOrg } from "../routers/server/queries";
import { isSwarmRuntime } from "../runtime";
import { type NodeResolution, pickNodeForServer } from "./node-resolver";

export interface PlacementOutcome {
  /** Node id to constrain to, or null to leave the service unpinned. */
  nodeId: string | null;
  /** Operator-facing explanation when a requested pin was not honoured. */
  warning: string | null;
}

/** Nothing was asked for, so nothing is wrong. */
const UNPINNED: PlacementOutcome = { nodeId: null, warning: null };

async function resolve(input: {
  placementServerId: ServerId | string | null | undefined;
  organizationId: OrganizationId;
}): Promise<{ outcome: PlacementOutcome; resolution: NodeResolution | null }> {
  if (!input.placementServerId) return { outcome: UNPINNED, resolution: null };

  if (!isSwarmRuntime()) {
    // Single-node docker: everything already runs on the one machine, so the
    // pin is satisfied by definition rather than ignored.
    return { outcome: UNPINNED, resolution: null };
  }

  const server = await getServerInOrg({
    serverId: input.placementServerId as ServerId,
    organizationId: input.organizationId,
  });
  if (!server) {
    const reason = `Placement target ${input.placementServerId} is not a server in this organization.`;
    return { outcome: { nodeId: null, warning: reason }, resolution: { kind: "unknown", reason } };
  }

  const docker = Docker.fromEnv();
  try {
    const nodes = await docker.nodes.list({});
    if (nodes.isErr()) {
      const reason = `Could not list swarm nodes to resolve placement: ${nodes.error.message}`;
      return {
        outcome: { nodeId: null, warning: reason },
        resolution: { kind: "unknown", reason },
      };
    }

    const resolution = pickNodeForServer(nodes.value, {
      hostname: server.hostname,
      name: server.name,
    });
    if (resolution.kind === "resolved") {
      return { outcome: { nodeId: resolution.nodeId, warning: null }, resolution };
    }
    return { outcome: { nodeId: null, warning: resolution.reason }, resolution };
  } finally {
    docker.destroy();
  }
}

/**
 * Placement for a stateless resource. Never throws: an unresolvable pin
 * degrades to "schedule anywhere" with a warning the caller should surface.
 */
async function resolvePlacementNodeId(input: {
  placementServerId: ServerId | string | null | undefined;
  organizationId: OrganizationId;
}): Promise<PlacementOutcome> {
  const { outcome } = await resolve(input);
  return outcome;
}

/**
 * Placement for a resource with a local volume. Throws rather than deploying
 * a stateful service away from its data: see the module note.
 */
async function requirePlacementNodeId(input: {
  placementServerId: ServerId | string | null | undefined;
  organizationId: OrganizationId;
  /** Named in the error so the operator knows which resource stalled. */
  resourceName: string;
}): Promise<PlacementOutcome> {
  const { outcome, resolution } = await resolve(input);
  if (resolution && resolution.kind !== "resolved") {
    throw new Error(
      `Refusing to deploy "${input.resourceName}" away from its data: ${resolution.reason} ` +
        `Bring that server back, or clear the placement pin to let it schedule elsewhere ` +
        `(its existing volume will NOT follow, restore from a backup instead).`,
    );
  }
  return outcome;
}

/**
 * Placement for a resource identified by project rather than org: the shape
 * the deploy path actually has. Resolves the owning organization first so the
 * server lookup stays tenant-scoped; skipped entirely when unpinned, so an
 * unpinned deploy pays for neither query.
 */
export async function resolvePlacementForProject(input: {
  placementServerId: ServerId | string | null | undefined;
  projectId: ProjectId;
  /** Named in the failure message for a stateful resource. */
  resourceName: string;
  /** True for anything owning a local volume: see the module note. */
  stateful: boolean;
}): Promise<PlacementOutcome> {
  if (!input.placementServerId) return UNPINNED;

  const [row] = await db
    .select({ organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, input.projectId))
    .limit(1);
  if (!row) return { nodeId: null, warning: `Project ${input.projectId} not found.` };

  const args = {
    placementServerId: input.placementServerId,
    organizationId: row.organizationId as OrganizationId,
  };
  return input.stateful
    ? requirePlacementNodeId({ ...args, resourceName: input.resourceName })
    : resolvePlacementNodeId(args);
}

/**
 * Placement read straight off the resource row. The entry point for deploy
 * paths that hold a resource id and nothing else. One join covers both the pin
 * and the owning organization, so the server lookup stays tenant-scoped.
 *
 * A resource that has never been pinned costs this one query and no docker
 * call.
 */
export async function resolvePlacementForResource(input: {
  resourceId: ResourceId | string;
  /** True for anything owning a local volume: see the module note. */
  stateful: boolean;
}): Promise<PlacementOutcome> {
  const [row] = await db
    .select({
      placementServerId: resource.placementServerId,
      name: resource.name,
      organizationId: project.organizationId,
    })
    .from(resource)
    .innerJoin(project, eq(resource.projectId, project.id))
    .where(eq(resource.id, input.resourceId as ResourceId))
    .limit(1);

  // A missing row is the caller's problem, not a placement failure. Deploying
  // unpinned is the honest answer here rather than inventing a constraint.
  if (!row?.placementServerId) return UNPINNED;

  const args = {
    placementServerId: row.placementServerId,
    organizationId: row.organizationId as OrganizationId,
  };
  return input.stateful
    ? requirePlacementNodeId({ ...args, resourceName: row.name })
    : resolvePlacementNodeId(args);
}
