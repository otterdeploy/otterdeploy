/**
 * Streaming container-log tail. Resolves a resource id to the running task's
 * container, attaches to docker's `containers/{id}/logs?follow=true&stdout&stderr`
 * stream, demuxes the multiplexed framing into stdout/stderr lines, and
 * yields one event per line.
 *
 * Docker stream framing (when TTY is false on the container, which is our
 * case for swarm services):
 *   - 8 byte header per chunk:
 *     - byte 0: stream type (0=stdin, 1=stdout, 2=stderr)
 *     - bytes 1-3: reserved
 *     - bytes 4-7: payload length (big-endian uint32)
 *   - N bytes of payload
 *
 * The reader buffers partial frames + partial lines so callers see whole
 * lines, not byte fragments. The generator's `finally` destroys the docker
 * client on disconnect so the underlying socket releases promptly when the
 * frontend closes the stream.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { sleep } from "@otterdeploy/shared/promise";

import { waitForServiceCreate } from "../../swarm";
import { demuxDockerStream, splitDockerTimestamp } from "../../swarm/stream-parse";
import { getProjectInOrg } from "./queries";
import { getProjectRecord } from "./queries";
import { getResourceById } from "./queries/resource";
import { buildContainerName } from "./views";

type OrgId = OrganizationId;

interface LogsRef {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
  tail?: number;
}

export interface ResourceLogEvent {
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

// Resolve a resource id to its swarm service name. Databases derive the name
// from project slug + resource name (we don't store a serviceName for them);
// service resources store it directly. Returns null when the resource row
// doesn't exist. Shared by every log-tail entry point in this file.
async function resolveServiceName(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<string | null> {
  const found = await getResourceById(projectId, resourceId);
  if (!found) return null;
  if (found.kind === "database") {
    const project = await getProjectRecord(projectId);
    const slug = project?.slug ?? projectId;
    return buildContainerName({
      engine: found.record.database.engine,
      projectSlug: slug,
      resourceName: found.record.resource.name,
    });
  }
  return found.record.service.serviceName;
}

// Resolve a resource id to the swarm service that owns it. Returns null when
// the resource doesn't exist OR the swarm service hasn't been created yet —
// for a freshly-inserted draft postgres resource, the row exists in our DB
// before the service-create call lands at the daemon, so we have to poll.
async function resolveServiceId(
  projectId: ProjectId,
  resourceId: ResourceId,
  docker: Docker,
): Promise<{ serviceName: string; serviceId: string | null } | null> {
  const serviceName = await resolveServiceName(projectId, resourceId);
  if (!serviceName) return null;

  const listResult = await docker.services.list({
    filters: { name: [serviceName] },
  });
  if (listResult.isErr()) return { serviceName, serviceId: null };
  const service = listResult.value.find(
    (s) => (s as { Spec?: { Name?: string } }).Spec?.Name === serviceName,
  );
  return {
    serviceName,
    serviceId: (service as { ID?: string } | undefined)?.ID ?? null,
  };
}

// Demux a docker log stream into ResourceLogEvents, peeling the ISO timestamp
// docker prepends (we attach `timestamps=true`). Thin adapter over the shared
// `demuxDockerStream` framing — exported so the project-wide log fan-in can
// reuse it without re-implementing the framing logic.
export async function* demuxDockerLogs(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<ResourceLogEvent, void, void> {
  for await (const chunk of demuxDockerStream(stream)) {
    const { ts, line } = splitDockerTimestamp(chunk.line);
    yield { stream: chunk.stream, line, ts };
  }
}

export async function* tailResourceLogs(
  input: LogsRef,
): AsyncGenerator<ResourceLogEvent, void, void> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    yield { stream: "system", line: "Project not found", ts: nowIso() };
    return;
  }

  const docker = Docker.fromEnv();
  try {
    // Switched from per-container `containers/{id}/logs` to swarm-level
    // `services/{id}/logs`: docker multiplexes output from every replica
    // and automatically follows new tasks when swarm rolls them. The
    // single endpoint replaces our old "find container → tail → wait for
    // replacement" loop and naturally handles multi-replica services
    // where we previously only saw whichever task we happened to resolve.
    //
    // We still poll initially because the user lands on the resource page
    // before the swarm service has been created (DB row inserted first,
    // service-create is a downstream step in the create stream).
    let attachedServiceId: string | null = null;
    let waitingMessageShown = false;
    const POLL_INTERVAL_MS = 2_000;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resolved = await resolveServiceId(input.projectId, input.resourceId, docker);
      if (!resolved) {
        yield { stream: "system", line: "Resource not found", ts: nowIso() };
        return;
      }

      if (!resolved.serviceId) {
        if (!waitingMessageShown) {
          yield {
            stream: "system",
            line: `Waiting for swarm service ${resolved.serviceName}…`,
            ts: nowIso(),
          };
          waitingMessageShown = true;
        }
        // Event-driven wait. The subscriber pushes `service.create` events
        // as docker emits them, so we react immediately instead of burning
        // a 2s poll cycle. The timeout falls back to polling on the off
        // chance the service was created in the window between our list
        // call above and the subscribe — extremely tight, but cheap to
        // cover. There's no replay across reconnects (events are
        // best-effort), so a polled re-check after the wait is the safety
        // net for that case too.
        const matched = await waitForServiceCreate(resolved.serviceName, {
          timeoutMs: POLL_INTERVAL_MS,
        }).catch(() => null);
        if (matched) {
          yield {
            stream: "system",
            line: `Service ${resolved.serviceName} just created — attaching…`,
            ts: nowIso(),
          };
        }
        continue;
      }

      // First attach OR new service id (operator deleted + recreated):
      // emit a single attach line so the tab is visibly "live".
      if (resolved.serviceId !== attachedServiceId) {
        attachedServiceId = resolved.serviceId;
        waitingMessageShown = false;
        yield {
          stream: "system",
          line: `Attached to service ${resolved.serviceName} (${resolved.serviceId.slice(0, 12)}) — multiplexed across all replicas`,
          ts: nowIso(),
        };
      }

      const logsResult = await docker.services.getService(resolved.serviceId).logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: String(input.tail ?? 100),
        timestamps: true,
      });

      if (logsResult.isErr()) {
        yield {
          stream: "system",
          line: `services.logs failed: ${logsResult.error.message}. Retrying…`,
          ts: nowIso(),
        };
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Drain until docker closes (service removed, daemon restarted, or
      // the long-running stream EOFs for any other reason). Then fall
      // through to the outer loop which will rediscover the service id
      // (or surface "waiting" if it's truly gone).
      for await (const event of demuxDockerLogs(logsResult.value)) {
        yield event;
      }

      yield {
        stream: "system",
        line: `Service log stream closed; reconnecting…`,
        ts: nowIso(),
      };
      attachedServiceId = null;
      await sleep(POLL_INTERVAL_MS);
    }
  } finally {
    // Release the docker socket when the client disconnects (the generator's
    // return method runs into this finally block).
    docker.destroy();
  }
}

interface TaskLogsRef {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
  taskId: string;
  tail?: number;
}

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

    const status = (
      task as {
        Status?: {
          State?: string;
          Message?: string;
          Err?: string;
          ContainerStatus?: { ContainerID?: string; ExitCode?: number };
        };
      }
    ).Status;
    const containerId = status?.ContainerStatus?.ContainerID ?? null;

    // Surface the task's own progress messages first — these are how swarm
    // reports "preparing", "pulling image", "starting", and the eventual
    // Err message on failure. Without these the operator only sees the
    // container's own stdout, which is empty until after the image is
    // pulled.
    if (status?.State) {
      yield {
        stream: "system",
        line: `Task state: ${status.State}${status.Message ? ` — ${status.Message}` : ""}`,
        ts: nowIso(),
      };
    }
    if (status?.Err) {
      yield {
        stream: "stderr",
        line: `Task error: ${status.Err}`,
        ts: nowIso(),
      };
    }
    if (
      typeof status?.ContainerStatus?.ExitCode === "number" &&
      status.ContainerStatus.ExitCode !== 0
    ) {
      yield {
        stream: "stderr",
        line: `Container exited with code ${status.ContainerStatus.ExitCode}`,
        ts: nowIso(),
      };
    }

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

interface DeploymentLogsRef {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
  deploymentId: string;
  tail?: number;
}

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

    for (let i = 0; i < sorted.length; i++) {
      const task = sorted[i]!;
      const isLast = i === sorted.length - 1;
      const status = task.Status ?? {};
      const containerId = status.ContainerStatus?.ContainerID ?? null;

      yield {
        stream: "system",
        line: `── Task ${(task.ID ?? "?").slice(0, 12)} · state: ${status.State ?? "?"}${status.Message ? ` — ${status.Message}` : ""} ──`,
        ts: nowIso(),
      };
      if (status.Err) {
        yield {
          stream: "stderr",
          line: `Task error: ${status.Err}`,
          ts: nowIso(),
        };
      }
      if (status.ContainerStatus?.ExitCode !== 0) {
        yield {
          stream: "stderr",
          line: `Container exited with code ${status.ContainerStatus?.ExitCode}`,
          ts: nowIso(),
        };
      }

      if (!containerId) continue;

      // Only follow=true for the last (most recent) task. Earlier tasks
      // are terminal — replay what docker still has and move on.
      const logsResult = await docker.containers.getContainer(containerId).logs({
        follow: isLast,
        stdout: true,
        stderr: true,
        tail: String(input.tail ?? 500),
        timestamps: true,
      });
      if (logsResult.isErr()) {
        yield {
          stream: "system",
          line: `docker logs failed for ${containerId.slice(0, 12)}: ${logsResult.error.message}`,
          ts: nowIso(),
        };
        continue;
      }

      for await (const event of demuxDockerLogs(logsResult.value)) {
        yield event;
      }
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
