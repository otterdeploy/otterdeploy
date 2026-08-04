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

import { proxyRouteSchema } from "./proxy";
import { basePath, projectNotFoundErrors, tag } from "./shared";
import { projectIdField, resourceIdField } from "./shared";

const projectEventSchema = z.union([
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
    kind: z.literal("route"),
    /** A proxy route was created or updated (enabled, protection, policy, cert
     *  state, DNS verification). Routes change from places the UI never
     *  touches — the reconciler, and cert/ACME promotion off the edge log — so
     *  without this the Networking view only refreshed when something else
     *  happened to invalidate it.
     *
     *  Unlike every other event here, this one carries the ROW rather than an
     *  id. Route rows are exactly what `proxyRoute.list` returns — a plain
     *  select, no runtime derivation — so the writer already holds the truth
     *  and the client can apply it without a round trip. Deployments cannot do
     *  this: their status is derived from live docker task state per read, so
     *  a pushed row would be stale the moment it was sent. */
    action: z.enum(["created", "updated"]),
    /** Dates are coerced because this row crossed a JSON boundary: the bus
     *  publishes with JSON.stringify, so every timestamp arrives as a string
     *  and a plain z.date() would reject the event — silently, since a failed
     *  output validation ends the stream rather than logging a bad row. */
    route: proxyRouteSchema.extend({
      createdAt: z.coerce.date(),
      updatedAt: z.coerce.date(),
      dnsCheckedAt: z.coerce.date().nullable(),
      certCheckedAt: z.coerce.date().nullable(),
      domainVerifiedAt: z.coerce.date().nullable(),
    }),
  }),
  z.object({
    kind: z.literal("route"),
    action: z.literal("removed"),
    /** Deletes carry the key only — there is no row left to describe. */
    routeId: z.string(),
    resourceId: resourceIdField.nullable(),
  }),
  z.object({
    kind: z.literal("container"),
    /** `start`, `die`, `kill`, `health_status: healthy`, … */
    action: z.string(),
    resourceId: resourceIdField,
    containerId: z.string(),
  }),
]);

const projectEventsStreamInput = z.object({
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
