/**
 * `docker node rm` for a registered server — down-only by design. The force
 * flag is deliberately not exposed: removing a live node orphans its tasks,
 * so the supported path is drain → (demote if manager) → stop the daemon on
 * the host → remove once the swarm reports the node `down`.
 *
 * This procedure only detaches the node from the swarm. The server ROW is
 * deleted by the caller through the normal server.delete flow afterwards —
 * keeping the two mutations separate means a failed row delete never leaves
 * the swarm claiming a node that was actually removed, and vice versa.
 */

import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";

import { isSwarmRuntime } from "../../runtime";
import {
  ServerNotFoundError,
  SwarmNodeNotDownError,
  SwarmNodeNotFoundError,
  SwarmNodeRemoveError,
  SwarmUnavailableError,
} from "./errors";
import { matchSwarmNode } from "./node-match";
import { getServerInOrg } from "./queries";
import { canRemoveFromSwarm } from "./swarm-guards";

export type RemoveNodeError =
  | ServerNotFoundError
  | SwarmUnavailableError
  | SwarmNodeNotFoundError
  | SwarmNodeNotDownError
  | SwarmNodeRemoveError;

export async function removeServerNode(
  input: {
    id: ServerId;
    organizationId: OrganizationId;
  },
  log?: RequestLogger,
): Promise<Result<{ ok: true }, RemoveNodeError>> {
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
        new SwarmNodeRemoveError({ serverId: input.id, cause: nodesResult.error.message }),
      );
    }

    const node = matchSwarmNode(nodesResult.value, record);
    if (!node?.ID) {
      return Result.err(new SwarmNodeNotFoundError({ serverId: input.id }));
    }

    if (!canRemoveFromSwarm(node)) {
      return Result.err(
        new SwarmNodeNotDownError({
          serverId: input.id,
          state: node.Status?.State ?? "unknown",
        }),
      );
    }

    // No force: the down-only guard above is the entire safety model.
    const removeResult = await docker.nodes.getNode(node.ID).remove();
    if (removeResult.isErr()) {
      return Result.err(
        new SwarmNodeRemoveError({ serverId: input.id, cause: removeResult.error.message }),
      );
    }

    log?.set({
      server: { step: "remove-node", serverId: input.id, nodeId: node.ID },
    });
  } finally {
    docker.destroy();
  }

  return Result.ok({ ok: true });
}
