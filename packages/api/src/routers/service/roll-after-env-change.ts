/**
 * Roll the thing that actually owns the container after an env write.
 *
 * `redeployAndFanOut` rolls ONE swarm service. For a compose child that is the
 * wrong owner: the swarm service belongs to the stack's reconcile, so the
 * update does not replace the task and the container keeps the old value
 * indefinitely — while the CLI prints "The service is rolling to pick up the
 * change." Verified on a live stack (od-eb2c): the container id was unchanged
 * across two minutes of polling after a successful bulkSet, and only
 * `otterdeploy redeploy <stack>` rolled it, at which point the new env was
 * live.
 *
 * So a child routes to `deployCompose(..., "env-change")` — the reason the
 * rollout enum already carried for exactly this — and a standalone service
 * keeps the single-service path. Rolling the whole stack is the honest cost:
 * it is what the manual workaround did, and a stack's services share one
 * materialization.
 *
 * Its own module because `compose/reconcile-rollout.ts` already imports
 * `service/redeploy.ts`; importing compose FROM redeploy would close that
 * loop. Nothing under compose/ imports this, so the graph stays acyclic.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";
import type { ResolveError, ServiceNotFoundError } from "./errors";

import { StackRollFailedError } from "./errors";
import { redeployAndFanOut } from "./redeploy";

export type RollFailure =
  | ProjectNotFoundError
  | ServiceNotFoundError
  | ResolveError
  | StackRollFailedError;

export async function rollAfterEnvChange(input: {
  projectId: ProjectId;
  resourceId: ResourceId;
  projectSlug: string;
  /** The owning stack, when this service is a compose child. */
  stackId: ResourceId | null | undefined;
  log: RequestLogger;
}): Promise<Result<true, RollFailure>> {
  if (input.stackId) {
    // Imported lazily on purpose. compose/deploy reaches service/expose ->
    // service/handlers -> env-handlers, which is what calls this, so a STATIC
    // edge here closes a seven-module import cycle (the audit ratchet gates on
    // the count). Deferring it keeps the static graph acyclic.
    const { deployCompose } = await import("../compose/deploy");
    const deployed = await deployCompose(
      { projectId: input.projectId, resourceId: input.stackId },
      "env-change",
      input.log,
    );
    // Tagged on the way out: the router's error mapping needs a `_tag`, and
    // the message has to say the value WAS saved even though it is not live.
    return deployed.isErr()
      ? Result.err(
          new StackRollFailedError({
            stackResourceId: input.stackId,
            detail: deployed.error.message,
          }),
        )
      : Result.ok(true);
  }
  return redeployAndFanOut(input.projectId, input.resourceId, input.projectSlug, input.log);
}
