/**
 * Normalized docker event shape.
 *
 * Docker's raw `/events` payload is a sprawling discriminated union — every
 * object type (container, service, network, volume, image, plugin, node,
 * config, secret, daemon) carries different attributes. We project the
 * subset we actually act on into a tagged union so consumers can switch on
 * `kind` and TypeScript narrows them to a known field set.
 *
 * Whenever a consumer needs a docker field we don't surface, prefer
 * extending this union (and the projector in `./normalize.ts`) over
 * dropping back to `event.raw` — the more we narrow here, the less docker
 * trivia leaks into call sites.
 */
import type { EventMessage } from "@otterdeploy/docker";

export type DockerEvent =
  | ContainerEvent
  | ServiceEvent
  | TaskEvent
  | NetworkEvent
  | NodeEvent
  | UnknownEvent;

interface BaseEvent {
  /** Docker server unix timestamp in nanoseconds. */
  timeNano: number;
  /** Original payload — kept around for fields we haven't narrowed yet. */
  raw: EventMessage;
}

export interface ContainerEvent extends BaseEvent {
  kind: "container";
  /** `start`, `die`, `health_status: healthy`, `oom`, `kill`, `destroy`, … */
  action: string;
  containerId: string;
  image: string | null;
  name: string | null;
  /** Container labels — includes `com.docker.swarm.service.id` /
   *  `com.docker.swarm.task.id` for swarm-managed containers. */
  labels: Record<string, string>;
  /** Convenience: extracted from labels for swarm-managed containers. */
  swarmServiceId: string | null;
  swarmTaskId: string | null;
}

export interface ServiceEvent extends BaseEvent {
  kind: "service";
  /** `create`, `update`, `remove`. */
  action: string;
  serviceId: string;
  name: string | null;
  labels: Record<string, string>;
}

export interface TaskEvent extends BaseEvent {
  kind: "task";
  /** `create`, `update`, `remove`. Task state transitions surface here. */
  action: string;
  taskId: string;
  serviceId: string | null;
  nodeId: string | null;
  /** Reported by docker on `update` events — running, failed, shutdown, … */
  state: string | null;
  labels: Record<string, string>;
}

export interface NetworkEvent extends BaseEvent {
  kind: "network";
  action: string;
  networkId: string;
  name: string | null;
}

export interface NodeEvent extends BaseEvent {
  kind: "node";
  action: string;
  nodeId: string;
}

/** Catch-all for event types we haven't typed yet — image / volume /
 *  plugin / config / secret / daemon, plus any future ones. Consumers
 *  shouldn't usually need to handle these. */
export interface UnknownEvent extends BaseEvent {
  kind: "unknown";
  type: string | null;
  action: string | null;
}
