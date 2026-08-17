/**
 * Extra-network attachment for the plain-Docker driver. `docker create`
 * honors only ONE NetworkingConfig endpoint, so additional memberships have
 * to be post-start connects (see createAndStart in ./docker-driver-helpers).
 * Split into its own module to keep that file under the line cap.
 */
import type { Docker } from "@otterdeploy/docker";
import type { RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";
import { resolveExtraNetworkTargets } from "../swarm/extra-networks";

/**
 * Join a freshly-started container to each requested extra network.
 * Per-network failures are non-fatal by design — a network the operator
 * deleted since attaching it must degrade to a logged skip, never a bricked
 * deploy. The project network (already joined at create, with the DNS
 * aliases) is skipped.
 */
export async function connectExtraNetworks(
  docker: Docker,
  containerName: string,
  projectNetwork: string,
  extraNetworks: string[],
  rlog?: RequestLogger,
): Promise<void> {
  const log = asStepLogger(rlog);
  for (const netName of resolveExtraNetworkTargets(extraNetworks, projectNetwork)) {
    const connected = await docker.networks
      .getNetwork(netName)
      .connect({ Container: containerName });
    if (connected.isErr()) {
      log.warn({
        runtime: {
          step: "connect-extra-network",
          service: containerName,
          network: netName,
          error: connected.error.message,
        },
      });
    }
  }
}
