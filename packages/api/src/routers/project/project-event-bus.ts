/**
 * Cross-process project event bus (Redis pub/sub).
 *
 * The project events stream (`events-stream.ts`) is fed by the *docker* event
 * bus — great for runtime (container/task) transitions, but build-phase status
 * changes (pending → building → running/failed) happen in the **builder
 * process** and produce no docker event, so the stream was silent during a
 * build and the UI fell back to slow polling.
 *
 * This bridges that gap: the builder (and any API-side status write) publishes
 * a resource-changed event to a per-project Redis channel; the stream in the
 * API process subscribes to it and pushes it to connected clients — real-time,
 * no polling. Same Bun `RedisClient` pub/sub the deployment log tail already
 * uses (`deployment/log-stream.ts`), so both processes just share Redis.
 *
 * Best-effort by design: publishing must never throw into the deploy path.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RedisClient } from "bun";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";

import type { ProxyRouteRecord } from "../../caddy/queries";
import type { ProjectStreamEvent } from "./events-stream";

import { createRedis } from "../../lib/redis";

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
 * Resolve the resource's project and publish a "resource updated" event — the
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
    // best-effort — never break the caller's deploy path
  }
}

/**
 * Publish a route row to its project's channel.
 *
 * Carries the ROW, not an id — the client applies it directly instead of
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
  // narrower one, so the same rule has to hold here — and it has to hold at the
  // PUBLISHER, because output validation downstream would strip them from the
  // response while they sat in Redis regardless.
  const { accessPinHash: _pin, domainVerifyToken: _token, ...safe } = route;
  publishProjectEvent(route.projectId, { kind: "route", action, route: safe });
}

/** Announce a removed route. No row survives a delete, so this carries keys. */
export function publishRouteRemoved(
  projectId: ProjectId | string,
  routeId: string,
  resourceId: ResourceId | null,
): void {
  publishProjectEvent(projectId, { kind: "route", action: "removed", routeId, resourceId });
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
      onEvent(JSON.parse(payload) as ProjectStreamEvent);
    } catch {
      // ignore malformed payloads
    }
  });
  return {
    close: () => {
      void sub.unsubscribe(ch).catch(() => undefined);
      sub.close();
    },
  };
}
