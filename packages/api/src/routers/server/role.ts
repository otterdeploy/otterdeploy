/**
 * `docker node promote` / `docker node demote` for a registered server —
 * the same node-match + full-NodeSpec-update pattern as availability.ts
 * (the role flip carries availability/labels over; see buildRoleUpdate).
 *
 * Honesty rules:
 *   - Plain-docker runtime has no roles to change → typed refusal.
 *   - Quorum guards run BEFORE docker is asked: demoting the last manager
 *     (409, cluster would be bricked) or the Raft leader (409, promote
 *     another manager first) is refused with a clear message instead of a
 *     raw daemon error.
 *   - The DB row's `role` column is only written AFTER docker confirms the
 *     node update, so the table never claims a promotion that didn't happen.
 */

import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";

import { isSwarmRuntime } from "../../runtime";
import {
  ServerNotFoundError,
  SwarmLastManagerError,
  SwarmLeaderDemoteError,
  SwarmNodeNotFoundError,
  SwarmNodeUpdateError,
  SwarmUnavailableError,
} from "./errors";
import { buildRoleUpdate, matchSwarmNode, type NodeRole } from "./node-match";
import { getServerInOrg, updateServerRoleRecord, type ServerRecord } from "./queries";
import { assessDemotion } from "./swarm-guards";

export type SetRoleError =
  | ServerNotFoundError
  | SwarmUnavailableError
  | SwarmNodeNotFoundError
  | SwarmLastManagerError
  | SwarmLeaderDemoteError
  | SwarmNodeUpdateError;

export async function setServerRole(
  input: {
    id: ServerId;
    role: NodeRole;
    organizationId: OrganizationId;
  },
  log?: RequestLogger,
): Promise<Result<ServerRecord, SetRoleError>> {
  const record = await getServerInOrg({
    serverId: input.id,
    organizationId: input.organizationId,
  });
  if (!record) {
    return Result.err(new ServerNotFoundError({ serverId: input.id }));
  }

  if (!isSwarmRuntime()) {
    return Result.err(new SwarmUnavailableError());
  }

  const docker = Docker.fromEnv();
  try {
    const nodesResult = await docker.nodes.list({});
    if (nodesResult.isErr()) {
      return Result.err(
        new SwarmNodeUpdateError({ serverId: input.id, cause: nodesResult.error.message }),
      );
    }

    const node = matchSwarmNode(nodesResult.value, record);
    if (!node?.ID) {
      return Result.err(new SwarmNodeNotFoundError({ serverId: input.id }));
    }

    if (input.role === "worker") {
      const block = assessDemotion(nodesResult.value, node);
      if (block === "last-manager") {
        return Result.err(new SwarmLastManagerError({ serverId: input.id }));
      }
      if (block === "leader") {
        return Result.err(new SwarmLeaderDemoteError({ serverId: input.id }));
      }
    }

    // Already in the requested role (e.g. row drifted from swarm truth):
    // skip the docker call and just mirror the confirmed state onto the row.
    if (node.Spec?.Role !== input.role) {
      const updateResult = await docker.nodes
        .getNode(node.ID)
        .update(buildRoleUpdate(node, input.role));
      if (updateResult.isErr()) {
        return Result.err(
          new SwarmNodeUpdateError({ serverId: input.id, cause: updateResult.error.message }),
        );
      }
    }

    log?.set({
      server: { step: "set-role", serverId: input.id, role: input.role },
    });
  } finally {
    docker.destroy();
  }

  // Docker confirmed — mirror the role onto the row so list/get agree.
  const updated = await updateServerRoleRecord({
    serverId: input.id,
    organizationId: input.organizationId,
    role: input.role,
  });
  // Row vanished between the node update and the write (concurrent delete).
  if (!updated) {
    return Result.err(new ServerNotFoundError({ serverId: input.id }));
  }
  return Result.ok(updated);
}
