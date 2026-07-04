/**
 * Aggregate log tail for an entire deployment. A swarm "deployment" maps to
 * N tasks (1 healthy task, or M failed retries before swarm gave up). This
 * generator walks the tasks oldest → newest and streams each container's
 * logs in turn, so the operator sees the full retry history in chronological
 * order under the deployment's Deploy Logs tab.
 *
 * The last task still attached is followed live (follow=true) — earlier
 * exited tasks replay what docker has on disk and then close, advancing to
 * the next.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";

import {
  demuxDockerLogs,
  nowIso,
  resolveServiceName,
  type ResourceLogEvent,
} from "./log-stream-shared";
import { getProjectInOrg } from "./queries";
import { listResourceInstances, type ResourceInstance } from "./resource-instances";

interface DeploymentLogsRef {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId: ResourceId;
  deploymentId: string;
  tail?: number;
}

// Stream a single deployment instance: its header + any error/exit lines, then —
// when a container exists — the container's logs (followed live only for the
// most recent instance).
async function* streamDeploymentInstance(
  docker: Docker,
  instance: ResourceInstance,
  isLast: boolean,
  tail: number,
): AsyncGenerator<ResourceLogEvent, void, void> {
  const containerId = instance.containerId;

  yield {
    stream: "system",
    line: `── ${(instance.id || "?").slice(0, 12)} · state: ${instance.state ?? "?"}${instance.message ? ` — ${instance.message}` : ""} ──`,
    ts: nowIso(),
  };
  if (instance.err) {
    yield { stream: "stderr", line: `Error: ${instance.err}`, ts: nowIso() };
  }
  if (typeof instance.exitCode === "number" && instance.exitCode !== 0) {
    yield {
      stream: "stderr",
      line: `Container exited with code ${instance.exitCode}`,
      ts: nowIso(),
    };
  }

  if (!containerId) return;

  // Only follow=true for the last (most recent) task. Earlier tasks are
  // terminal — replay what docker still has and move on.
  const logsResult = await docker.containers.getContainer(containerId).logs({
    follow: isLast,
    stdout: true,
    stderr: true,
    tail: String(tail),
    timestamps: true,
  });
  if (logsResult.isErr()) {
    yield {
      stream: "system",
      line: `docker logs failed for ${containerId.slice(0, 12)}: ${logsResult.error.message}`,
      ts: nowIso(),
    };
    return;
  }

  for await (const event of demuxDockerLogs(logsResult.value)) {
    yield event;
  }
}

export async function* tailDeploymentLogs(
  input: DeploymentLogsRef,
): AsyncGenerator<ResourceLogEvent, void, void> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    yield { stream: "system", line: "Project not found", ts: nowIso() };
    return;
  }

  const serviceName = await resolveServiceName(input.projectId, input.resourceId);
  if (!serviceName) {
    yield { stream: "system", line: "Resource not found", ts: nowIso() };
    return;
  }

  const docker = Docker.fromEnv();
  try {
    const instancesResult = await listResourceInstances(docker, serviceName);
    if (instancesResult.isErr()) {
      yield {
        stream: "system",
        line: `Could not list instances for ${serviceName}: ${instancesResult.error.message}`,
        ts: nowIso(),
      };
      return;
    }

    // Prefer instances tagged with this deployment id; fall back to all of the
    // service's instances when none are tagged (plain Docker recreates in place
    // and older containers carry a prior deployment's label).
    const tagged = instancesResult.value.filter((t) => t.deploymentId === input.deploymentId);
    const instances = tagged.length > 0 ? tagged : instancesResult.value;

    if (instances.length === 0) {
      yield {
        stream: "system",
        line: "No container has run for this deployment yet. If the build is still in progress or failed, check the Build Logs tab.",
        ts: nowIso(),
      };
      return;
    }

    // Oldest first → newest. We stream the failed retries in order so the
    // user can read the cascade from top to bottom.
    const sorted = [...instances].sort((a, b) => {
      const at = new Date(a.createdAt ?? 0).getTime();
      const bt = new Date(b.createdAt ?? 0).getTime();
      return at - bt;
    });

    for (const [i, instance] of sorted.entries()) {
      yield* streamDeploymentInstance(docker, instance, i === sorted.length - 1, input.tail ?? 500);
    }

    yield {
      stream: "system",
      line: "End of deployment logs.",
      ts: nowIso(),
    };
  } finally {
    docker.destroy();
  }
}
