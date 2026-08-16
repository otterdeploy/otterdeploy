/**
 * Pure bus-event → wire-event mapping for the docker events stream.
 *
 * Separate from `events-stream.ts` (which owns the subscription/queue
 * machinery) because the generator pulls in the swarm barrel — and with it
 * the db client — while this mapping only needs types. That keeps the unit
 * test (`__tests__/events-wire.test.ts`) runnable without a bun runtime.
 *
 * The normalizer only types container/service/task/network/node events;
 * image and volume events reach us as `kind: "unknown"` with the original
 * payload on `raw`, and are recovered from the raw `Type`/`Actor` fields
 * (already typed as `EventMessage` — no JSON boundary here, the subscriber
 * parsed the daemon's NDJSON before normalizing).
 */

import type { DockerEvent } from "../../swarm/events/types";

export const DOCKER_EVENT_TYPES = [
  "container",
  "service",
  "task",
  "network",
  "node",
  "image",
  "volume",
  "unknown",
] as const;
export type DockerEventType = (typeof DOCKER_EVENT_TYPES)[number];

export interface DockerWireEvent {
  ts: number;
  type: DockerEventType;
  action: string;
  actorId: string;
  actorName: string | null;
  attributes: Record<string, string>;
}

/** Narrow a raw daemon `Type` string to the wire vocabulary without a cast —
 *  literal comparison against the tuple is the type guard. */
function toWireType(type: string | null | undefined): DockerEventType {
  for (const known of DOCKER_EVENT_TYPES) {
    if (known === type) return known;
  }
  return "unknown";
}

/** Actor attributes off the raw payload, for the kinds the normalizer
 *  doesn't carry them on (network/node/unknown). `raw` is a typed
 *  `EventMessage` — plain property reads, no JSON boundary. */
function rawAttributes(event: DockerEvent): Record<string, string> {
  return event.raw.Actor?.Attributes ?? {};
}

/** Image / volume / plugin / config / secret / daemon events — the
 *  normalizer keeps them opaque, so the fields come off `raw`. Image events
 *  name the ref in Actor.ID and often repeat it under Attributes.name. */
function unknownToWire(
  event: Extract<DockerEvent, { kind: "unknown" }>,
  ts: number,
): DockerWireEvent {
  const attributes = rawAttributes(event);
  return {
    ts,
    type: toWireType(event.type),
    action: event.action ?? "",
    actorId: event.raw.Actor?.ID ?? "",
    actorName: attributes.name ?? null,
    attributes,
  };
}

/** Flatten one normalized bus event into the wire shape the contract declares. */
export function toWireEvent(event: DockerEvent): DockerWireEvent {
  // The bus stamps nanoseconds (falling back to seconds × 1e9 upstream);
  // the wire carries milliseconds because that's what Date wants.
  const ts = Math.floor(event.timeNano / 1_000_000);
  switch (event.kind) {
    case "container":
      return {
        ts,
        type: "container",
        action: event.action,
        actorId: event.containerId,
        actorName: event.name,
        attributes: event.labels,
      };
    case "service":
      return {
        ts,
        type: "service",
        action: event.action,
        actorId: event.serviceId,
        actorName: event.name,
        attributes: event.labels,
      };
    case "task":
      return {
        ts,
        type: "task",
        action: event.action,
        actorId: event.taskId,
        // Tasks carry no `name` attribute — the owning service's name is the
        // closest human handle the daemon gives us.
        actorName: event.labels["com.docker.swarm.service.name"] ?? null,
        attributes: event.labels,
      };
    case "network":
      return {
        ts,
        type: "network",
        action: event.action,
        actorId: event.networkId,
        actorName: event.name,
        attributes: rawAttributes(event),
      };
    case "node":
      return {
        ts,
        type: "node",
        action: event.action,
        actorId: event.nodeId,
        actorName: rawAttributes(event).name ?? null,
        attributes: rawAttributes(event),
      };
    case "unknown":
      return unknownToWire(event, ts);
  }
}
