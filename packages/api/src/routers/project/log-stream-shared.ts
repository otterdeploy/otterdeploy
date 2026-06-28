/**
 * Shared primitives for the container-log tail generators (resource / task /
 * deployment). Leaf module — resolves resource ids to swarm service names +
 * ids, and demuxes docker's multiplexed log framing into ResourceLogEvents.
 *
 * Docker stream framing (when TTY is false on the container, which is our
 * case for swarm services):
 *   - 8 byte header per chunk:
 *     - byte 0: stream type (0=stdin, 1=stdout, 2=stderr)
 *     - bytes 1-3: reserved
 *     - bytes 4-7: payload length (big-endian uint32)
 *   - N bytes of payload
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";

import { demuxDockerStream, splitDockerTimestamp } from "../../swarm/stream-parse";
import { getProjectRecord } from "./queries";
import { getResourceById } from "./queries/resource";
import { buildContainerName } from "./views";

export interface ResourceLogEvent {
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// Resolve a resource id to its swarm service name. Databases derive the name
// from project slug + resource name (we don't store a serviceName for them);
// service resources store it directly. Returns null when the resource row
// doesn't exist. Shared by every log-tail entry point.
export async function resolveServiceName(
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
export async function resolveServiceId(
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
// `demuxDockerStream` framing — reused by the project-wide log fan-in without
// re-implementing the framing logic.
export async function* demuxDockerLogs(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<ResourceLogEvent, void, void> {
  for await (const chunk of demuxDockerStream(stream)) {
    const { ts, line } = splitDockerTimestamp(chunk.line);
    yield { stream: chunk.stream, line, ts };
  }
}
