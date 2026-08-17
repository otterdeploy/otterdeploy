/**
 * Pin a service to a server, or release it back to the scheduler, and move it
 * there in the same call.
 *
 * There is exactly ONE writable surface for placement (this), the same rule
 * the exposure settings follow. A second place to set it would drift from the
 * first, and placement is not the kind of thing that can be half-right: two
 * surfaces disagreeing means a service that says it lives on one machine and
 * runs on another.
 *
 * Setting the pin without redeploying would be a lie. The constraint only
 * takes effect on the next rollout, so this always rolls the service. That is
 * the "move" operation: swarm starts the task on the new node before stopping
 * the old one (start-first, from the shared UpdateConfig), so a stateless move
 * has no gap.
 *
 * What this deliberately does NOT do is move data. A service with a local
 * volume that moves node gets a fresh empty volume there; the old one stays
 * behind on the old machine. Callers must opt into that explicitly.
 */

import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { loadResource } from "./context";
import { PlacementVolumeLossError, type ResolveError, ServiceNotFoundError } from "./errors";
import { getService } from "./handlers";
import { type ResourceRef } from "./inputs";
import { setResourcePlacement } from "./queries";
import { redeployOne } from "./redeploy";
import { type ServiceView } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;

export interface SetPlacementInput extends ResourceRef {
  /** Server to pin to, or null to let the scheduler place it anywhere. */
  serverId: string | null;
  /**
   * Required acknowledgement when the service has mounts that live on the
   * node. Without it a move is refused, because the volume does not follow and
   * the service comes up on the new machine with an empty one.
   */
  acknowledgeVolumeLoss?: boolean;
}

export async function setServicePlacement(
  input: SetPlacementInput,
  log: RequestLogger,
): Promise<Result<ServiceView, NotFound | ResolveError | PlacementVolumeLossError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { record, project } = ctx.value;

  const current = record.resource.placementServerId ?? null;
  // Idempotent: re-pinning to the same node would otherwise cause a pointless
  // rollout every time the settings form is saved.
  if (current === input.serverId) return getService(input);

  // Named volumes are node-local. Moving is still allowed. Sometimes the old
  // node is gone and an empty start is the only way forward, but never
  // silently.
  const volumeMounts = record.mounts.filter((m) => m.type === "volume").map((m) => m.target);
  if (volumeMounts.length > 0 && !input.acknowledgeVolumeLoss) {
    return Result.err(
      new PlacementVolumeLossError({ resourceId: input.resourceId, mounts: volumeMounts }),
    );
  }

  await setResourcePlacement(input.resourceId, input.serverId);
  log.set({
    placement: {
      service: record.service.serviceName,
      from: current,
      to: input.serverId,
      volumeMountsAbandoned: volumeMounts.length,
    },
  });

  // The constraint only exists in a spec, so nothing has actually moved until
  // the service rolls. Failing here leaves the pin recorded. The next deploy
  // will honour it, which is why the error is returned rather than reverting.
  const rolled = await redeployOne(input.projectId, input.resourceId, project.slug, log);
  if (rolled.isErr()) return Result.err(rolled.error);

  return getService(input);
}
