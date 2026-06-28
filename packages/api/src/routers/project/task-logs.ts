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

interface TaskLogsRef {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId: ResourceId;
  taskId: string;
  tail?: number;
}

interface TaskStatus {
  State?: string;
  Message?: string;
  Err?: string;
  ContainerStatus?: { ContainerID?: string; ExitCode?: number };
}

// Surface the task's own progress messages first — these are how swarm reports
// "preparing", "pulling image", "starting", and the eventual Err message on
// failure. Without these the operator only sees the container's own stdout,
// which is empty until after the image is pulled.
async function* emitTaskStatusPreamble(
  status: TaskStatus,
): AsyncGenerator<ResourceLogEvent, void, void> {
  if (status.State) {
    yield {
      stream: "system",
      line: `Task state: ${status.State}${status.Message ? ` — ${status.Message}` : ""}`,
      ts: nowIso(),
    };
  }
  if (status.Err) {
    yield { stream: "stderr", line: `Task error: ${status.Err}`, ts: nowIso() };
  }
  const exitCode = status.ContainerStatus?.ExitCode;
  if (typeof exitCode === "number" && exitCode !== 0) {
    yield { stream: "stderr", line: `Container exited with code ${exitCode}`, ts: nowIso() };
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
    // Find the requested task. Filtering on service alone is enough — if the
    // taskId doesn't show up here the caller's snooping at another resource.
    const tasksResult = await docker.tasks.list({
      filters: { service: [serviceName] },
    });
    if (tasksResult.isErr()) {
      yield {
        stream: "system",
        line: `docker tasks list failed: ${tasksResult.error.message}`,
        ts: nowIso(),
      };
      return;
    }

    const task = tasksResult.value.find((t) => (t as { ID?: string }).ID === input.taskId);
    if (!task) {
      yield {
        stream: "system",
        line: `Task ${input.taskId.slice(0, 12)} not found on service ${serviceName}`,
        ts: nowIso(),
      };
      return;
    }

    const status = (task as { Status?: TaskStatus }).Status ?? {};
    const containerId = status.ContainerStatus?.ContainerID ?? null;

    yield* emitTaskStatusPreamble(status);

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
