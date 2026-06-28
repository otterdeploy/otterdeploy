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

interface DeploymentLogsRef {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId: ResourceId;
  deploymentId: string;
  tail?: number;
}

interface TaskShape {
  ID?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
  Spec?: { ContainerSpec?: { Labels?: Record<string, string> } };
  Status?: {
    State?: string;
    Message?: string;
    Err?: string;
    Timestamp?: string;
    ContainerStatus?: { ContainerID?: string; ExitCode?: number };
  };
}

// Stream a single deployment task: its header + any error/exit lines, then —
// when a container exists — the container's logs (followed live only for the
// most recent task).
async function* streamDeploymentTask(
  docker: Docker,
  task: TaskShape,
  isLast: boolean,
  tail: number,
): AsyncGenerator<ResourceLogEvent, void, void> {
  const status = task.Status ?? {};
  const containerId = status.ContainerStatus?.ContainerID ?? null;

  yield {
    stream: "system",
    line: `── Task ${(task.ID ?? "?").slice(0, 12)} · state: ${status.State ?? "?"}${status.Message ? ` — ${status.Message}` : ""} ──`,
    ts: nowIso(),
  };
  if (status.Err) {
    yield { stream: "stderr", line: `Task error: ${status.Err}`, ts: nowIso() };
  }
  if (status.ContainerStatus?.ExitCode !== 0) {
    yield {
      stream: "stderr",
      line: `Container exited with code ${status.ContainerStatus?.ExitCode}`,
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

    const tasks = (tasksResult.value as TaskShape[]).filter(
      (t) => t.Spec?.ContainerSpec?.Labels?.["otterdeploy.deployment.id"] === input.deploymentId,
    );

    if (tasks.length === 0) {
      yield {
        stream: "system",
        line: "No tasks scheduled under this deployment yet.",
        ts: nowIso(),
      };
      return;
    }

    // Oldest first → newest. We stream the failed retries in order so the
    // user can read the cascade from top to bottom.
    const sorted = [...tasks].sort((a, b) => {
      const at = new Date(a.CreatedAt ?? 0).getTime();
      const bt = new Date(b.CreatedAt ?? 0).getTime();
      return at - bt;
    });

    for (const [i, task] of sorted.entries()) {
      yield* streamDeploymentTask(docker, task, i === sorted.length - 1, input.tail ?? 500);
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
