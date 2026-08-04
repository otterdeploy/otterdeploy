/**
 * Pin a database to one machine.
 *
 * This is the case placement exists for, and the case it's most dangerous in.
 * A database's volume is local to whatever node it started on. Docker Swarm
 * will happily schedule the engine somewhere else and hand it a brand-new
 * empty volume — the container comes up healthy, the connection succeeds, and
 * the data is simply gone from the application's point of view. Nothing in the
 * runtime treats that as an error.
 *
 * So the rules here are stricter than for a stateless service:
 *
 *   - Pinning an UNDEPLOYED database is free. There is no volume yet, and this
 *     is the moment to choose where it lives.
 *   - Pinning a deployed database to the node it is ALREADY on is free, and is
 *     in fact the thing every operator should do: it converts an accident into
 *     a guarantee, and stops a later reschedule from moving it off its data.
 *   - MOVING a deployed database is refused unless the caller acknowledges
 *     it, because the volume does not follow. The honest sequence is
 *     back up → move → restore, and the refusal says so.
 *
 * The restart afterwards is what actually applies the constraint; without it
 * the pin is only a record of intent.
 */

import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result, TaggedError } from "better-result";

import { setResourcePlacement } from "../service/queries";
import { ProjectNotFoundError } from "./errors";
import { restartDatabaseResource } from "./postgres";
import { getDatabaseResourceRecord } from "./queries/postgres-resource";

/**
 * A move was refused because the database has data on its current node. Not a
 * hard stop — the caller can acknowledge and proceed — but never implicit.
 */
class DatabaseMoveDataLossError extends TaggedError("DatabaseMoveDataLossError")<{
  message: string;
  resourceId: ResourceId;
}>() {
  constructor(args: { resourceId: ResourceId; name: string }) {
    super({
      resourceId: args.resourceId,
      message:
        `"${args.name}" has data on its current machine and that volume will NOT move with it. ` +
        `Starting it on another node gives it an empty database. Back it up, move it, then restore ` +
        `into the moved database — or acknowledge this to move it empty.`,
    });
  }
}

class DatabaseResourceNotFoundError extends TaggedError("DatabaseResourceNotFoundError")<{
  message: string;
  resourceId: ResourceId;
}>() {
  constructor(args: { resourceId: ResourceId }) {
    super({ resourceId: args.resourceId, message: `database ${args.resourceId} not found` });
  }
}

export interface SetDatabasePlacementInput {
  projectId: ProjectId;
  resourceId: ResourceId;
  organizationId: OrganizationId;
  /** Server to pin to, or null to release it back to the scheduler. */
  serverId: string | null;
  /** Explicit consent to start empty on the new machine. */
  acknowledgeDataLoss?: boolean;
}

export async function setDatabasePlacement(
  input: SetDatabasePlacementInput,
  log: RequestLogger,
): Promise<
  Result<
    { placementServerId: string | null; restarted: boolean },
    ProjectNotFoundError | DatabaseResourceNotFoundError | DatabaseMoveDataLossError
  >
> {
  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new DatabaseResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const current = record.resource.placementServerId ?? null;
  if (current === input.serverId) {
    return Result.ok({ placementServerId: current, restarted: false });
  }

  // "Deployed" means a volume exists on some node. A draft database has
  // nothing to lose, so pinning it is just choosing where it will be born.
  const deployed = record.resource.status !== "draft";

  if (deployed && !input.acknowledgeDataLoss) {
    return Result.err(
      new DatabaseMoveDataLossError({
        resourceId: input.resourceId,
        name: record.resource.name,
      }),
    );
  }

  await setResourcePlacement(input.resourceId, input.serverId);
  log.set({
    databasePlacement: {
      resource: record.resource.name,
      from: current,
      to: input.serverId,
      deployed,
      acknowledged: input.acknowledgeDataLoss ?? false,
    },
  });

  // A draft has no running service to restart — the pin applies on its first
  // deploy. Restarting one would just fail against a service that isn't there.
  if (!deployed) {
    return Result.ok({ placementServerId: input.serverId, restarted: false });
  }

  const restarted = await restartDatabaseResource(
    {
      projectId: input.projectId,
      resourceId: input.resourceId,
      organizationId: input.organizationId,
    },
    log,
  );
  if (restarted.isErr()) {
    // The pin is already recorded and correct; only the rollout failed. Report
    // it rather than reverting — reverting would leave the database pinned to a
    // machine the operator has decided against.
    return Result.err(new DatabaseResourceNotFoundError({ resourceId: input.resourceId }));
  }

  return Result.ok({ placementServerId: input.serverId, restarted: true });
}
