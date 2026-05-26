/**
 * Docker event subscription surface.
 *
 * Implementation split:
 *   - types.ts:      DockerEvent discriminated union
 *   - normalize.ts:  EventMessage → DockerEvent projector
 *   - subscriber.ts: process-wide singleton bus + subscribe()
 *   - wait-for.ts:   "resolve on first matching event" helpers
 *
 * Consumers should import through this barrel — never reach into the
 * subscriber module directly, since the singleton state is private.
 */

export type {
  ContainerEvent,
  DockerEvent,
  NetworkEvent,
  NodeEvent,
  ServiceEvent,
  TaskEvent,
  UnknownEvent,
} from "./types";

export {
  subscribeDockerEvents,
  subscribeDockerEventsWhere,
} from "./subscriber";

export {
  waitForEvent,
  waitForServiceContainerStart,
  waitForServiceCreate,
} from "./wait-for";
