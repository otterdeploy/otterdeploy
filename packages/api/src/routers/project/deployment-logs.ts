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
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";

import { fetchLogsAfter } from "../deployment/log-stream";
import {
  demuxDockerLogs,
  nowIso,
  resolveServiceNames,
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

  // Deploy-phase platform log first — the rollout + restart/health lines the
  // builder ("updating swarm service", "deployment running") and crash-watcher
  // ("container exited — restarting…") recorded. These belong with Deploy, not
  // Build. The containers' own stdout/stderr streams underneath.
  for (const line of await fetchLogsAfter(input.deploymentId as DeploymentId, 0, "deploy")) {
    yield { stream: line.stream, line: line.line, ts: line.ts };
  }

  // One swarm service for a plain resource; every `${stack}-${key}` child for
  // a compose stack (the stack deployment tracks the rollout as a whole).
  const serviceNames = await resolveServiceNames(input.projectId, input.resourceId);
  if (!serviceNames || serviceNames.length === 0) {
    yield { stream: "system", line: "Resource not found", ts: nowIso() };
    return;
  }

  const docker = Docker.fromEnv();
  try {
    const all: ResourceInstance[] = [];
    for (const serviceName of serviceNames) {
      const instancesResult = await listResourceInstances(docker, serviceName);
      if (instancesResult.isErr()) {
        yield {
          stream: "system",
          line: `Could not list instances for ${serviceName}: ${instancesResult.error.message}`,
          ts: nowIso(),
        };
        continue;
      }
      all.push(...instancesResult.value);
    }

    // Prefer instances tagged with this deployment id; fall back to all of the
    // service's instances when none are tagged (plain Docker recreates in place
    // and older containers carry a prior deployment's label; a compose stack's
    // containers are tagged with their per-service deployment ids, not the
    // stack row's).
    const tagged = all.filter((t) => t.deploymentId === input.deploymentId);
    const instances = tagged.length > 0 ? tagged : all;

    // No container ran for this deployment. Emit nothing and let the stream end
    // cleanly — the client renders a proper empty state (icon + "check Build
    // Logs" hint) for a deploy-logs stream that ends with zero lines. A stream
    // where a container DID run always carries at least the trailing "End of
    // deployment logs." line below, so ended-with-zero-lines unambiguously
    // means "no container".
    if (instances.length === 0) {
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
