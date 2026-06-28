/**
 * Streaming container-log tail. Resolves a resource id to the running swarm
 * service, attaches to docker's `services/{id}/logs?follow=true&stdout&stderr`
 * stream, demuxes the multiplexed framing into stdout/stderr lines, and yields
 * one event per line. The generator's `finally` destroys the docker client on
 * disconnect so the underlying socket releases promptly when the frontend
 * closes the stream.
 *
 * Shared framing + service resolution live in ./log-stream-shared; the
 * per-task (./task-logs) and per-deployment (./deployment-logs) tails are
 * re-exported here so the project handler split keeps one import surface.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { sleep } from "@otterdeploy/shared/promise";

import { waitForServiceCreate } from "../../swarm";
import {
  demuxDockerLogs,
  nowIso,
  resolveServiceId,
  type ResourceLogEvent,
} from "./log-stream-shared";
import { getProjectInOrg } from "./queries";

type OrgId = OrganizationId;

interface LogsRef {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
  tail?: number;
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

// Re-exported so the project handler split keeps importing the log tails (and
// the shared event type + demuxer) from "./resource-logs".
export { demuxDockerLogs, type ResourceLogEvent } from "./log-stream-shared";
export { tailTaskLogs } from "./task-logs";
export { tailDeploymentLogs } from "./deployment-logs";
