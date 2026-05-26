/**
 * Project a raw docker `EventMessage` into a `DockerEvent`. The mapping is
 * intentionally narrow — we only call out the fields that map to TS-typed
 * accessors on the consumer side. Anything else stays accessible via
 * `.raw` for one-off needs without bloating the shared type.
 */

import type { EventMessage } from "@otterdeploy/docker";

import type { DockerEvent } from "./types";

export function normalizeDockerEvent(raw: EventMessage): DockerEvent {
  const timeNano = raw.timeNano ?? (raw.time ?? 0) * 1_000_000_000;
  const action = raw.Action ?? "";
  const id = raw.Actor?.ID ?? "";
  const attrs = raw.Actor?.Attributes ?? {};

  switch (raw.Type) {
    case "container":
      return {
        kind: "container",
        action,
        containerId: id,
        image: attrs.image ?? null,
        name: attrs.name ?? null,
        labels: attrs,
        swarmServiceId: attrs["com.docker.swarm.service.id"] ?? null,
        swarmTaskId: attrs["com.docker.swarm.task.id"] ?? null,
        timeNano,
        raw,
      };
    case "service":
      return {
        kind: "service",
        action,
        serviceId: id,
        name: attrs.name ?? null,
        labels: attrs,
        timeNano,
        raw,
      };
    case "task":
      return {
        kind: "task",
        action,
        taskId: id,
        // Swarm sets these as event attributes on most task events.
        serviceId: attrs["com.docker.swarm.service.id"] ?? null,
        nodeId: attrs["com.docker.swarm.node.id"] ?? null,
        state: attrs.state ?? null,
        labels: attrs,
        timeNano,
        raw,
      };
    case "network":
      return {
        kind: "network",
        action,
        networkId: id,
        name: attrs.name ?? null,
        timeNano,
        raw,
      };
    case "node":
      return {
        kind: "node",
        action,
        nodeId: id,
        timeNano,
        raw,
      };
    default:
      return {
        kind: "unknown",
        type: raw.Type ?? null,
        action: raw.Action ?? null,
        timeNano,
        raw,
      };
  }
}
