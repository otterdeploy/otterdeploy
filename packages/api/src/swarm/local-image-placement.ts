/**
 * Where a registry-less image may run on a swarm.
 *
 * With no image repository set, the builder `--load`s the image into the
 * daemon it shares with the control plane and pushes it nowhere
 * (apps/builder/src/load.ts): `otterdeploy-local/<service>` exists on that one
 * node. On a single-node swarm that is everywhere. Once a worker joins, an
 * unpinned service may be scheduled onto it, and the task fails: "pull access
 * denied for otterdeploy-local/…, repository does not exist".
 * So an unpinned registry-less image is pinned to the node that holds it. An
 * explicit pin is left as the operator set it.
 */
import type { Docker } from "@otterdeploy/docker";

import { isSwarmNodeId } from "./placement";

/** The namespace the builder tags registry-less images under. */
const LOCAL_IMAGE_NAMESPACE = "otterdeploy-local/";

/** The node a service's tasks are pinned to: the operator's pin, else the
 *  local node for a registry-less image, else none. */
export function placementForImage(input: {
  image: string;
  placementNodeId: string | null | undefined;
  localNodeId: unknown;
}): string | null {
  if (input.placementNodeId) return input.placementNodeId;
  if (!input.image.startsWith(LOCAL_IMAGE_NAMESPACE)) return null;
  return isSwarmNodeId(input.localNodeId) ? input.localNodeId : null;
}

/** `spec` with a registry-less image pinned to this daemon's swarm node. */
export async function pinLocalImage<T extends { image: string; placementNodeId?: string | null }>(
  docker: Docker,
  spec: T,
): Promise<T> {
  if (spec.placementNodeId || !spec.image.startsWith(LOCAL_IMAGE_NAMESPACE)) return spec;
  const info = await docker.system.info();
  if (info.isErr()) return spec;
  const placementNodeId = placementForImage({
    image: spec.image,
    placementNodeId: spec.placementNodeId,
    localNodeId: info.value.Swarm?.NodeID,
  });
  return placementNodeId ? { ...spec, placementNodeId } : spec;
}
