/**
 * Container boot-log tail helper.
 *
 * Resolves the swarm service's running container, attaches to its log
 * stream, and yields one event per stdout/stderr line until either the
 * `readyPattern` matches or `timeoutMs` elapses. Used by
 * createPostgresResourceStream to show postgres' own startup messages
 * (initdb output, "ready to accept connections") in the wizard.
 */

import { Docker } from "@otterdeploy/docker";

import { subscribeDockerEvents } from "../../../swarm";
import { demuxDockerStream } from "../../../swarm/stream-parse";

export interface BootLogEvent {
  stream: "stdout" | "stderr";
  line: string;
}

async function resolveServiceContainerId(
  docker: Docker,
  serviceName: string,
): Promise<string | null> {
  const tasksResult = await docker.tasks.list({ filters: { service: [serviceName] } });
  if (tasksResult.isErr()) return null;
  const running = tasksResult.value.find(
    (t) => (t as { Status?: { State?: string } }).Status?.State === "running",
  );
  return (
    (running as { Status?: { ContainerStatus?: { ContainerID?: string } } } | undefined)?.Status
      ?.ContainerStatus?.ContainerID ?? null
  );
}

/**
 * Resolve the container id for a freshly-created swarm service.
 *
 * Strategy: snapshot first (the container might already exist by the time
 * we're called), then wait on `container.start` events filtered to the
 * service's label until the deadline. The combination is intentional —
 * pure event-wait would miss a container that started in the window
 * between service.create completing and our subscribe; pure poll wastes
 * 250ms cycles in the common case where the container is seconds away.
 */
async function waitForRunningContainer(
  docker: Docker,
  serviceName: string,
  deadlineMs: number,
): Promise<string | null> {
  // Snapshot. Cheap and covers the "already running" race.
  const snap = await resolveServiceContainerId(docker, serviceName);
  if (snap) return snap;

  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => finish(null), Math.max(0, deadlineMs - Date.now()));
    const sub = subscribeDockerEvents((event) => {
      if (event.kind !== "container") return;
      if (event.action !== "start") return;
      // Swarm tags every container with the originating service's name.
      // The label key is `com.docker.swarm.service.name`.
      if (event.labels["com.docker.swarm.service.name"] !== serviceName) return;
      finish(event.containerId);
    });

    let settled = false;
    function finish(id: string | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.close();
      resolve(id);
    }
  });
}

export async function* tailContainerBootLogs(input: {
  serviceName: string;
  timeoutMs: number;
  readyPattern: RegExp;
}): AsyncGenerator<BootLogEvent, void, void> {
  const docker = Docker.fromEnv();
  try {
    // Wait for the first container backing this service to enter `start`.
    // Drops a ~3s polling window down to a single event hop in the common
    // case — `container.start` typically arrives within tens of ms of swarm
    // scheduling the task. Bounded at 3s so a stuck service surfaces as a
    // clean "no container yet" instead of hanging the create stream.
    const containerId = await waitForRunningContainer(
      docker,
      input.serviceName,
      Date.now() + 3_000,
    );
    if (!containerId) return;

    const logsResult = await docker.containers.getContainer(containerId).logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: "100",
    });
    if (logsResult.isErr()) throw logsResult.error;

    const deadline = Date.now() + input.timeoutMs;
    const stream = logsResult.value as NodeJS.ReadableStream & {
      destroy?: () => void;
    };
    const closeStream = () => {
      try {
        stream.destroy?.();
      } catch {
        // best-effort — the demuxer's for-await will end either way.
      }
    };

    // Race the demuxer against the deadline. When the deadline hits, we
    // destroy the underlying stream which ends the for-await loop cleanly.
    const timer = setTimeout(closeStream, input.timeoutMs);
    try {
      for await (const event of demuxDockerStream(stream)) {
        yield event;
        if (input.readyPattern.test(event.line)) {
          closeStream();
          return;
        }
        if (Date.now() >= deadline) {
          closeStream();
          return;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } finally {
    docker.destroy();
  }
}
