/**
 * `docker node update --availability <active|drain|pause>` for a registered
 * server. The server table doesn't store swarm node ids (see stats.ts), so
 * the node is resolved by matching the swarm node's Description.Hostname
 * against the row's `hostname` (OS hostname) or `name` (friendly label) —
 * the same join the stats aggregation uses.
 *
 * Honesty rules:
 *   - Plain-docker runtime has no scheduler to drain → typed refusal, the UI
 *     rolls its optimistic change back instead of pretending.
 *   - The DB row's `availability` column is only written AFTER docker
 *     confirms the node update, so the UI never shows a drain that the
 *     scheduler isn't actually doing.
 */

import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";

import { isSwarmRuntime } from "../../runtime";
import {
  ServerNotFoundError,
  SwarmNodeNotFoundError,
  SwarmNodeUpdateError,
  SwarmUnavailableError,
} from "./errors";
import { buildAvailabilityUpdate, matchSwarmNode, type NodeAvailability } from "./node-match";
import { getServerInOrg, updateServerAvailabilityRecord, type ServerRecord } from "./queries";

export type SetAvailabilityError =
  | ServerNotFoundError
  | SwarmUnavailableError
  | SwarmNodeNotFoundError
  | SwarmNodeUpdateError;

export async function setServerAvailability(
  input: {
    id: ServerId;
    availability: NodeAvailability;
    organizationId: OrganizationId;
  },
  log?: RequestLogger,
): Promise<Result<ServerRecord, SetAvailabilityError>> {
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

    const updateResult = await docker.nodes
      .getNode(node.ID)
      .update(buildAvailabilityUpdate(node, input.availability));
    if (updateResult.isErr()) {
      return Result.err(
        new SwarmNodeUpdateError({ serverId: input.id, cause: updateResult.error.message }),
      );
    }

    log?.set({
      server: { step: "set-availability", serverId: input.id, availability: input.availability },
    });
  } finally {
    docker.destroy();
  }

  // Docker confirmed — mirror the availability onto the row so list/get agree.
  const updated = await updateServerAvailabilityRecord({
    serverId: input.id,
    organizationId: input.organizationId,
    availability: input.availability,
  });
  // Row vanished between the node update and the write (concurrent delete).
  if (!updated) {
    return Result.err(new ServerNotFoundError({ serverId: input.id }));
  }
  return Result.ok(updated);
}
