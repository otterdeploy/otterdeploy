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
export function publishProjectEvent(
  projectId: ProjectId | string,
  event: ProjectStreamEvent,
): void {
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
