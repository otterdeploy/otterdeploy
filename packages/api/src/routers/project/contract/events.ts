/**
 * Live project event stream — push-side replacement for `useLiveQuery`
 * polling on the resource/deployments/logs pages.
 *
 * The server subscribes to the docker event bus, filters events to the
 * caller's project (via the `otterdeploy.project` label on the underlying
 * service), and yields one slim event per change. Frontend consumers
 * react by invalidating the queries that own the affected data — the
 * actual data fetches still go through the existing oRPC endpoints, so
 * payloads don't pass through this channel.
 *
 * The event shape is intentionally tiny: a verb + which thing changed.
 * Anything that needs more context comes from a follow-up read query —
 * keeps the push channel cheap to maintain and easy to reason about.
 */

import { eventIterator, oc } from "@orpc/contract";
import * as z from "zod";

import { basePath, projectNotFoundErrors, tag } from "./shared";
import { projectIdField, resourceIdField } from "./shared";

export const projectEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("resource"),
    /** `created`, `updated`, `removed`. Matches the docker `service.*` action
     *  the event was derived from. */
    action: z.enum(["created", "updated", "removed"]),
    resourceId: resourceIdField,
  }),
  z.object({
    kind: z.literal("task"),
    /** Lifecycle transition reported by docker (`update`, `create`,
     *  `remove`). The frontend doesn't need the full state machine — it
     *  just refetches the deployment + tasks views. */
    action: z.string(),
    resourceId: resourceIdField,
    taskId: z.string(),
    /** Raw docker task state when known (`running`, `failed`, `shutdown`,
     *  …). Optional because some actions don't carry it. */
    state: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("container"),
    /** `start`, `die`, `kill`, `health_status: healthy`, … */
    action: z.string(),
    resourceId: resourceIdField,
    containerId: z.string(),
  }),
]);

export const projectEventsStreamInput = z.object({
  projectId: projectIdField,
});

export const projectEventsContractSlice = {
  /** Long-lived event stream for one project. Stays open as long as the
   *  client keeps the request alive; sub-second push of swarm state
   *  changes filtered to resources owned by this project. */
  stream: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/events`,
      tag,
      method: "GET",
    })
    .input(projectEventsStreamInput)
    .output(eventIterator(projectEventSchema)),
};
