/**
 * Post-join swarm verification: split out of provision-runner.ts to keep
 * that file under the line cap. Confirms a freshly `docker swarm join`-ed
 * host actually appears ready in `docker node ls` (the manager-side check;
 * the join itself runs over SSH), and applies the optional build-node label.
 */
import type { Node } from "@otterdeploy/docker";

import { Docker } from "@otterdeploy/docker";

const VERIFY_ATTEMPTS = 30;
const VERIFY_INTERVAL_MS = 2000;
const BUILD_NODE_LABEL = "otterdeploy.role";

/** Poll the local manager's `docker node ls` until a node with `hostname`
 *  reports ready; return the node so callers can label it. */
export async function verifyNodeJoined(
  hostname: string,
  emit: (line: string) => void,
): Promise<Node | null> {
  const docker = Docker.fromEnv();
  try {
    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
      const nodes = await docker.nodes.list({});
      if (nodes.isOk()) {
        const match = nodes.value.find((n) => n.Description?.Hostname === hostname);
        if (match?.Status?.State === "ready") return match;
        if (match) emit(`node ${hostname} present, state: ${match.Status?.State ?? "unknown"}…`);
      }
      await new Promise((r) => setTimeout(r, VERIFY_INTERVAL_MS));
    }
    return null;
  } finally {
    docker.destroy();
  }
}

/** Add the `otterdeploy.role=build` swarm label so build workloads can target
 *  this node. Carries the full existing NodeSpec (labels/role/availability) so
 *  the update doesn't clear anything. Best-effort: a label failure doesn't fail
 *  an otherwise-joined node. */
export async function labelBuildNode(node: Node, emit: (line: string) => void): Promise<void> {
  if (!node.ID) return;
  const docker = Docker.fromEnv();
  try {
    const update = await docker.nodes.getNode(node.ID).update({
      version: node.Version?.Index ?? 0,
      ...(node.Spec?.Name !== undefined ? { Name: node.Spec.Name } : {}),
      ...(node.Spec?.Role !== undefined ? { Role: node.Spec.Role } : {}),
      ...(node.Spec?.Availability !== undefined ? { Availability: node.Spec.Availability } : {}),
      Labels: { ...node.Spec?.Labels, [BUILD_NODE_LABEL]: "build" },
    });
    if (update.isErr()) emit(`could not apply build label: ${update.error.message}`);
  } finally {
    docker.destroy();
  }
}
