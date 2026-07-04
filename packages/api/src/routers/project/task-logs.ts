/**
 * Stream logs for one specific swarm task. Used by the deployment-detail
 * panel — clicking a row in Recent deployments opens the logs for THAT task's
 * container, not the currently-running one.
 *
 * Unlike tailResourceLogs there's no respawn-polling loop: a task is a single
 * container lifecycle, so once docker EOFs the stream we're done. For a
 * still-running task we follow live; for an exited task we replay what docker
 * still has on disk and then close.
 *
 * Org scoping is enforced both ways:
 *   - project must be in the caller's org
 *   - the task must belong to the resource's swarm service (otherwise the
 *     handler refuses, even if the caller knows the task id)
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

interface TaskLogsRef {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId: ResourceId;
  taskId: string;
  tail?: number;
}

// Surface the instance's own progress messages first — swarm reports
// "preparing", "pulling image", "starting", and the eventual Err on failure;
// plain-docker carries the container's human status line. Without these the
// operator only sees the container's own stdout, which is empty until the
// image is pulled.
async function* emitInstancePreamble(
  instance: ResourceInstance,
): AsyncGenerator<ResourceLogEvent, void, void> {
  if (instance.state) {
    yield {
      stream: "system",
      line: `State: ${instance.state}${instance.message ? ` — ${instance.message}` : ""}`,
      ts: nowIso(),
    };
  }
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
}

export async function* tailTaskLogs(
  input: TaskLogsRef,
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
    // Enumerate the resource's instances (swarm tasks or docker containers).
    // Filtering on the service alone is enough — if the id doesn't show up here
    // the caller's snooping at another resource.
    const instancesResult = await listResourceInstances(docker, serviceName);
    if (instancesResult.isErr()) {
      yield {
        stream: "system",
        line: `Could not list instances for ${serviceName}: ${instancesResult.error.message}`,
        ts: nowIso(),
      };
      return;
    }

    const instance = instancesResult.value.find((t) => t.id === input.taskId);
    if (!instance) {
      yield {
        stream: "system",
        line: `Instance ${input.taskId.slice(0, 12)} not found on ${serviceName} — it may have been replaced by a newer deploy.`,
        ts: nowIso(),
      };
      return;
    }

    const containerId = instance.containerId;

    yield* emitInstancePreamble(instance);

    if (!containerId) {
      // No container has been created yet — task is still pending/preparing.
      // The state line above tells the user where we are; nothing more to
      // stream until docker has a container id.
      yield {
        stream: "system",
        line: "No container assigned to this task yet — re-open this row once preparing completes.",
        ts: nowIso(),
      };
      return;
    }

    yield {
      stream: "system",
      line: `Attached to ${containerId.slice(0, 12)} (task ${input.taskId.slice(0, 12)})`,
      ts: nowIso(),
    };

    const logsResult = await docker.containers.getContainer(containerId).logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: String(input.tail ?? 500),
      timestamps: true,
    });
    if (logsResult.isErr()) {
      yield {
        stream: "system",
        line: `docker logs failed: ${logsResult.error.message}`,
        ts: nowIso(),
      };
      return;
    }

    for await (const event of demuxDockerLogs(logsResult.value)) {
      yield event;
    }

    yield {
      stream: "system",
      line: "Log stream closed.",
      ts: nowIso(),
    };
  } finally {
    docker.destroy();
  }
}
