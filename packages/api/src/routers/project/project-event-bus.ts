/**
 * Cross-process project event bus (Redis pub/sub).
 *
 * The project events stream (`events-stream.ts`) is fed by the *docker* event
 * bus: great for runtime (container/task) transitions, but build-phase status
 * changes (pending → building → running/failed) happen in the **builder
 * process** and produce no docker event, so the stream was silent during a
 * build and the UI fell back to slow polling.
 *
 * This bridges that gap: the builder (and any API-side status write) publishes
 * a resource-changed event to a per-project Redis channel; the stream in the
 * API process subscribes to it and pushes it to connected clients. Real-time,
 * no polling. Same Bun `RedisClient` pub/sub the deployment log tail already
 * uses (`deployment/log-stream.ts`), so both processes just share Redis.
 *
 * Best-effort by design: publishing must never throw into the deploy path.
 */

import type { OrgBusEvent, OrgStreamCollection } from "@otterdeploy/shared/org-events";
import type { RedisClient } from "bun";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema";
import {
  ID_PREFIX,
  zId,
  type ProjectId,
  type ProxyRouteId,
  type ResourceId,
} from "@otterdeploy/shared/id";
import {
  ORG_ROW_COLLECTIONS,
  ORG_STREAM_COLLECTIONS,
  orgEventsChannel,
} from "@otterdeploy/shared/org-events";
import { eq } from "drizzle-orm";
import * as z from "zod";

import type { ProxyRouteRecord } from "../../caddy/queries";
import type { ProjectStreamEvent } from "./events-stream";

import { createRedis } from "../../lib/redis";
import { proxyRouteSchema } from "./contract/proxy";
import { proxyRouteIdField, resourceIdField } from "./contract/shared";

// ── Wire schemas ─────────────────────────────────────────────────────────
//
// Everything on the bus crossed a JSON.stringify/parse boundary, so payloads
// are PARSED back into the typed event shapes, never cast. Dates on route
// rows arrive as ISO strings and are coerced back (the events contract does
// the same on its own output for the identical reason).

const orgConnectionRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  engine: z.enum(["postgres", "mariadb"]),
  displayHost: z.string(),
  displayDatabase: z.string(),
  visibility: z.enum(["org", "private"]),
  environment: z.enum(["production", "other"]),
  defaultAccess: z.enum(["read-only", "read-write"]),
  requireTls: z.boolean(),
  createdAt: z.string(),
  lastConnectedAt: z.string().nullable(),
});

const orgBusEventSchema = z.union([
  z.object({ kind: z.enum(ORG_STREAM_COLLECTIONS) }),
  z.object({
    kind: z.enum(ORG_ROW_COLLECTIONS),
    op: z.literal("upsert"),
    rows: z.array(orgConnectionRowSchema),
  }),
  z.object({
    kind: z.enum(ORG_ROW_COLLECTIONS),
    op: z.literal("delete"),
    keys: z.array(z.string()),
  }),
]);

const busRouteSchema = proxyRouteSchema.extend({
  // The route row's previewId carries the PreviewId brand; re-apply it after
  // the JSON round-trip or the parsed event won't satisfy PublishableRoute.
  previewId: zId(ID_PREFIX.preview).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  dnsCheckedAt: z.coerce.date().nullable(),
  certCheckedAt: z.coerce.date().nullable(),
  domainVerifiedAt: z.coerce.date().nullable(),
});

const projectBusEventSchema = z.union([
  z.object({
    kind: z.literal("resource"),
    action: z.enum(["created", "updated", "removed"]),
    resourceId: resourceIdField,
  }),
  z.object({
    kind: z.literal("route"),
    action: z.enum(["created", "updated"]),
    route: busRouteSchema,
  }),
  z.object({
    kind: z.literal("route"),
    action: z.literal("removed"),
    routeId: proxyRouteIdField,
    resourceId: resourceIdField.nullable(),
  }),
  z.object({
    kind: z.literal("task"),
    action: z.string(),
    resourceId: resourceIdField,
    taskId: z.string(),
    state: z.string().nullable(),
  }),
  z.object({ kind: z.literal("manifest"), action: z.literal("changed") }),
  z.object({ kind: z.literal("previews"), action: z.literal("changed") }),
  z.object({
    kind: z.literal("container"),
    action: z.string(),
    resourceId: resourceIdField,
    containerId: z.string(),
  }),
]);

/** JSON-decode + schema-validate one bus payload; null for malformed ones. */
function parseBusPayload<T>(payload: string, schema: z.ZodType<T>): T | null {
  try {
    const decoded: unknown = JSON.parse(payload);
    const result = schema.safeParse(decoded);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const channel = (projectId: ProjectId | string) => `project:${projectId}:events`;

// One shared publisher client for the process. `publish` never puts a client
// into subscriber mode, so a single connection is safe to reuse.
let publisher: RedisClient | null = null;
function getPublisher(): RedisClient {
  publisher ??= createRedis();
  return publisher;
}

/** Publish a raw event to a project's channel. Fire-and-forget. */
function publishProjectEvent(projectId: ProjectId | string, event: ProjectStreamEvent): void {
  void Promise.resolve()
    .then(() => getPublisher().publish(channel(projectId), JSON.stringify(event)))
    .catch(() => undefined);
}

/**
 * Resolve the resource's project and publish a "resource updated" event. The
 * frontend's `useProjectEvents` reacts by invalidating that resource's
 * deployment list + status, so a build-status change lands instantly. One
 * cheap indexed lookup per transition; swallows all errors.
 */
export async function publishResourceChanged(resourceId: ResourceId): Promise<void> {
  try {
    const [row] = await db
      .select({ projectId: resource.projectId })
      .from(resource)
      .where(eq(resource.id, resourceId))
      .limit(1);
    if (!row) return;
    publishProjectEvent(row.projectId, { kind: "resource", action: "updated", resourceId });
  } catch {
    // best-effort, never break the caller's deploy path
  }
}

/**
 * Announce that the project's staged manifest changed (save / apply /
 * discard / git apply). Carries no payload. The collection stream turns it
 * into a `manifest` resync and consumers refetch diff/manifest/stack reads,
 * which lets those queries idle at a slow backstop instead of polling.
 */
export function publishManifestChanged(projectId: ProjectId | string): void {
  publishProjectEvent(projectId, { kind: "manifest", action: "changed" });
}

/** Announce a preview lifecycle change (PR opened / updated / closed). Same
 *  contract as manifest: no payload, consumers resync `previews.list`. */
export function publishPreviewsChanged(projectId: ProjectId | string): void {
  publishProjectEvent(projectId, { kind: "previews", action: "changed" });
}

/**
 * Publish a route row to its project's channel.
 *
 * Carries the ROW, not an id. The client applies it directly instead of
 * refetching. That is only sound because a proxy route is a plain select:
 * `proxyRoute.list` returns the stored row, so the writer already holds
 * exactly what every reader would compute. (Deployments deliberately do NOT
 * work this way; their status is derived from live docker task state, so a
 * pushed row would be stale on arrival.)
 *
 * Preview routes are skipped: the project collection lists base routes only,
 * so pushing a preview row would insert something no reader asked for.
 *
 * Best-effort, like every publish here: never throws into a write path.
 */
export function publishRouteUpserted(action: "created" | "updated", route: ProxyRouteRecord): void {
  if (route.previewId != null) return;
  // NEVER put these on the bus. Every route output schema omits the access-PIN
  // hash and the domain-verification token so no endpoint can leak them; a
  // pub/sub channel is a wider audience than an authorized HTTP response, not a
  // narrower one, so the same rule has to hold here, and it has to hold at the
  // PUBLISHER, because output validation downstream would strip them from the
  // response while they sat in Redis regardless.
  const { accessPinHash: _pin, domainVerifyToken: _token, ...safe } = route;
  publishProjectEvent(route.projectId, { kind: "route", action, route: safe });
}

/** Announce a removed route. No row survives a delete, so this carries keys. */
export function publishRouteRemoved(
  projectId: ProjectId | string,
  routeId: ProxyRouteId,
  resourceId: ResourceId | null,
): void {
  publishProjectEvent(projectId, { kind: "route", action: "removed", routeId, resourceId });
}

/**
 * Publish an org-scoped, payload-free change announcement (activity counts,
 * inbox, servers). Same best-effort rules as the project channel. The jobs
 * workers publish to the same channel with their own client. The wire shape
 * lives in @otterdeploy/shared/org-events so the two can't drift.
 */
export function publishOrgEvent(organizationId: string, kind: OrgStreamCollection): void {
  publishOrgBusEvent(organizationId, { kind });
}

/**
 * Publish a whole event, including the row-carrying shapes.
 *
 * Best-effort, like every publish on this bus: a dropped event costs freshness,
 * never correctness, because the collection's snapshot query is still the
 * source of truth and repairs on reconnect.
 */
export function publishOrgBusEvent(organizationId: string, event: OrgBusEvent): void {
  void Promise.resolve()
    .then(() => getPublisher().publish(orgEventsChannel(organizationId), JSON.stringify(event)))
    .catch(() => undefined);
}

/** Subscribe to an organization's channel. Same contract as
 *  {@link subscribeProjectEvents}: dedicated connection, `close()` to stop. */
export function subscribeOrgEvents(
  organizationId: string,
  onEvent: (event: OrgBusEvent) => void,
): { close: () => void } {
  const sub = createRedis();
  const ch = orgEventsChannel(organizationId);
  void sub.subscribe(ch, (payload) => {
    try {
      const event = parseBusPayload(payload, orgBusEventSchema);
      if (event) onEvent(event);
    } catch {
      // best-effort: a listener error must not kill the subscriber
    }
  });
  return {
    close: () => {
      void sub.unsubscribe(ch).catch(() => undefined);
      sub.close();
    },
  };
}

/** Subscribe to a project's channel. Returns a `close()` to tear down the
 *  dedicated subscriber connection. */
export function subscribeProjectEvents(
  projectId: ProjectId,
  onEvent: (event: ProjectStreamEvent) => void,
): { close: () => void } {
  const sub = createRedis();
  const ch = channel(projectId);
  void sub.subscribe(ch, (payload) => {
    try {
      const event = parseBusPayload(payload, projectBusEventSchema);
      if (event) onEvent(event);
    } catch {
      // best-effort: a listener error must not kill the subscriber
    }
  });
  return {
    close: () => {
      void sub.unsubscribe(ch).catch(() => undefined);
      sub.close();
    },
  };
}
