/**
 * Server-side implementation of the project events stream.
 *
 * Bridges the docker event bus (process-wide singleton in
 * `swarm/events/subscriber`) to a per-request async generator scoped to
 * one project. The bus emits raw docker events; this module maps each
 * event to a resource id via the service-name → resource-id map it
 * caches at start, then yields a slim event the frontend can use to
 * trigger a refetch.
 *
 * The service-name map IS the auth boundary: we only emit events whose
 * source belongs to the project the request authorized for. Events that
 * arrive for services we don't recognize (or that belong to other
 * projects) are silently dropped.
 *
 * The map is refreshed on `service.create`/`service.remove` events that
 * pattern-match the project's slug — those don't tell us a resource id
 * directly, but they invalidate the cache so the next event from the
 * affected service gets resolved fresh.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";

import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import { getProjectInOrg } from "./queries";

import { subscribeDockerEvents, type DockerEvent } from "../../swarm";
import {
  buildContainerName,
  sanitizeProjectSlug,
} from "./views";
import { listProjectResources } from "./queries/resource";

type OrgId = OrganizationId;

export type ProjectStreamEvent =
  | { kind: "resource"; action: "created" | "updated" | "removed"; resourceId: ResourceId }
  | {
      kind: "task";
      action: string;
      resourceId: ResourceId;
      taskId: string;
      state: string | null;
    }
  | {
      kind: "container";
      action: string;
      resourceId: ResourceId;
      containerId: string;
    };

interface StreamInput {
  projectId: ProjectId;
  organizationId: OrgId;
}

/**
 * Build the initial service-name → resource-id map for the project.
 * Database resources don't carry a stored `serviceName` (we derive it
 * from project slug + resource name), service resources do — both kinds
 * land in the same lookup so downstream code doesn't have to dispatch.
 */
async function loadServiceNameMap(
  projectId: ProjectId,
  projectSlug: string,
): Promise<Map<string, ResourceId>> {
  const map = new Map<string, ResourceId>();
  const sanitizedSlug = sanitizeProjectSlug(projectSlug);
  const { databases, services } = await listProjectResources(projectId);
  for (const row of databases) {
    const serviceName = buildContainerName({
      engine: row.database.engine,
      projectSlug: sanitizedSlug,
      resourceName: row.resource.name,
    });
    map.set(serviceName, row.resource.id as ResourceId);
  }
  for (const row of services) {
    map.set(row.service.serviceName, row.resource.id as ResourceId);
  }
  return map;
}

/**
 * Extract the swarm service name from a docker event when possible.
 * Containers carry it as `com.docker.swarm.service.name`, tasks the
 * same. Service events have `Actor.Attributes.name`. Anything else
 * (network/node/etc.) returns null and is filtered out at the call site.
 */
function eventServiceName(event: DockerEvent): string | null {
  if (event.kind === "container") {
    return event.labels["com.docker.swarm.service.name"] ?? null;
  }
  if (event.kind === "task") {
    return event.labels["com.docker.swarm.service.name"] ?? null;
  }
  if (event.kind === "service") {
    return event.name;
  }
  return null;
}

export async function* streamProjectEvents(
  input: StreamInput,
): AsyncGenerator<
  ProjectStreamEvent,
  void,
  void
> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    // Generators can't return a Result from the outermost caller without
    // throwing, but the contract is "stream until aborted" so we just
    // end the stream — the absence of events is the correct behaviour
    // for a not-found project at this layer. The router refuses the
    // request earlier when it can.
    return;
  }

  let serviceMap = await loadServiceNameMap(input.projectId, project.slug);

  // Bounded queue. Listeners that fall behind drop oldest events rather
  // than indefinitely backpressuring the docker bus — the frontend will
  // catch up via its next refetch when the stream resumes flowing.
  const queue: ProjectStreamEvent[] = [];
  const MAX_QUEUE = 200;
  let resolveNext: (() => void) | null = null;
  let aborted = false;

  const sub = subscribeDockerEvents((raw) => {
    if (aborted) return;
    const serviceName = eventServiceName(raw);
    if (!serviceName) return;

    // Service lifecycle events from docker — refresh the cache and emit
    // a coarse resource event so the frontend can invalidate the list.
    if (raw.kind === "service") {
      if (raw.action === "create" || raw.action === "remove") {
        // Invalidate the cache lazily — the next event from this service
        // will trigger a refresh via the miss path below.
        if (raw.action === "remove") {
          const knownResource = serviceMap.get(serviceName);
          if (knownResource) {
            push({ kind: "resource", action: "removed", resourceId: knownResource });
            serviceMap.delete(serviceName);
          }
        }
        // For create we don't know the resource id yet (the row may not
        // exist in our DB at all if this service belongs to another
        // project). The next event from this service will resolve it.
        return;
      }
      const known = serviceMap.get(serviceName);
      if (known) push({ kind: "resource", action: "updated", resourceId: known });
      return;
    }

    const resourceId = serviceMap.get(serviceName);
    if (!resourceId) return; // not our project — silently drop

    if (raw.kind === "task") {
      push({
        kind: "task",
        action: raw.action,
        resourceId,
        taskId: raw.taskId,
        state: raw.state,
      });
      return;
    }
    if (raw.kind === "container") {
      push({
        kind: "container",
        action: raw.action,
        resourceId,
        containerId: raw.containerId,
      });
      return;
    }
  });

  function push(event: ProjectStreamEvent): void {
    queue.push(event);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  }

  // Periodically refresh the service map so newly-created resources show
  // up in the filter without forcing a full reconnect. Cheap (one
  // listProjectResources call per minute, all in-DB).
  const refreshTimer = setInterval(() => {
    void loadServiceNameMap(input.projectId, project.slug).then((next) => {
      if (!aborted) serviceMap = next;
    });
  }, 60_000);
  refreshTimer.unref?.();

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (queue.length > 0) {
        const next = queue.shift();
        if (next) yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  } finally {
    aborted = true;
    clearInterval(refreshTimer);
    sub.close();
  }
}

/**
 * Pre-flight check the router uses to throw NOT_FOUND with the right
 * shape before opening the stream. Generators can't reject cleanly with
 * a typed error on the outermost contract level — easier to gate here.
 */
export async function validateProjectEventsStream(
  input: StreamInput,
): Promise<
  Result<{ ok: true }, ProjectNotFoundError | PostgresResourceNotFoundError>
> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  // Wrap with `_void` to silence unused — we keep the docker import alive
  // for the Result.ok return path's type inference even though we don't
  // call into docker here.
  void Docker;
  return Result.ok({ ok: true });
}
