/**
 * Project a raw docker `EventMessage` into a `DockerEvent`. The mapping is
 * intentionally narrow — we only call out the fields that map to TS-typed
 * accessors on the consumer side. Anything else stays accessible via
 * `.raw` for one-off needs without bloating the shared type.
 */

import type { EventMessage } from "@otterdeploy/docker";

import type { DockerEvent } from "./types";

function commonFields(raw: EventMessage) {
  return {
    timeNano: raw.timeNano ?? (raw.time ?? 0) * 1_000_000_000,
    action: raw.Action ?? "",
    id: raw.Actor?.ID ?? "",
    attrs: raw.Actor?.Attributes ?? {},
  };
}
type CommonFields = ReturnType<typeof commonFields>;

function containerEvent(c: CommonFields, raw: EventMessage): DockerEvent {
  return {
    kind: "container",
    action: c.action,
    containerId: c.id,
    image: c.attrs.image ?? null,
    name: c.attrs.name ?? null,
    labels: c.attrs,
    swarmServiceId: c.attrs["com.docker.swarm.service.id"] ?? null,
    swarmTaskId: c.attrs["com.docker.swarm.task.id"] ?? null,
    timeNano: c.timeNano,
    raw,
  };
}

function serviceEvent(c: CommonFields, raw: EventMessage): DockerEvent {
  return {
    kind: "service",
    action: c.action,
    serviceId: c.id,
    name: c.attrs.name ?? null,
    labels: c.attrs,
    timeNano: c.timeNano,
    raw,
  };
}

function taskEvent(c: CommonFields, raw: EventMessage): DockerEvent {
  return {
    kind: "task",
    action: c.action,
    taskId: c.id,
    // Swarm sets these as event attributes on most task events.
    serviceId: c.attrs["com.docker.swarm.service.id"] ?? null,
    nodeId: c.attrs["com.docker.swarm.node.id"] ?? null,
    state: c.attrs.state ?? null,
    labels: c.attrs,
    timeNano: c.timeNano,
    raw,
  };
}

function networkEvent(c: CommonFields, raw: EventMessage): DockerEvent {
  return {
    kind: "network",
    action: c.action,
    networkId: c.id,
    name: c.attrs.name ?? null,
    timeNano: c.timeNano,
    raw,
  };
}

function nodeEvent(c: CommonFields, raw: EventMessage): DockerEvent {
  return {
    kind: "node",
    action: c.action,
    nodeId: c.id,
    timeNano: c.timeNano,
    raw,
  };
}

function unknownEvent(c: CommonFields, raw: EventMessage): DockerEvent {
  return {
    kind: "unknown",
    type: raw.Type ?? null,
    action: raw.Action ?? null,
    timeNano: c.timeNano,
    raw,
  };
}

export function normalizeDockerEvent(raw: EventMessage): DockerEvent {
  const c = commonFields(raw);

  switch (raw.Type) {
    case "container":
      return containerEvent(c, raw);
    case "service":
      return serviceEvent(c, raw);
    case "task":
      return taskEvent(c, raw);
    case "network":
      return networkEvent(c, raw);
    case "node":
      return nodeEvent(c, raw);
    default:
      return unknownEvent(c, raw);
  }
}
