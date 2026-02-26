# Resource Health Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Real-time detection of container deaths via Docker event stream, updating resource status in the database instantly.

**Architecture:** A background Docker event stream listener starts when the worker boots. It subscribes to `dockerode.getEvents()`, filters for container die/stop/kill events on otterstack-labeled Swarm services, debounces rapid events, checks remaining container health, and updates the DB + emits Inngest events.

**Tech Stack:** dockerode (already installed), Drizzle ORM, Inngest events, @otterdeploy/logger

---

### Task 1: Add `watchContainerEvents` to Docker package

**Files:**
- Create: `packages/docker/src/events.ts`
- Modify: `packages/docker/src/index.ts`

**Step 1: Create `packages/docker/src/events.ts`**

This module subscribes to Docker's event stream via `dockerode.getEvents()`, filters for container death events on Swarm services, and invokes a callback with the parsed event.

```typescript
import { createLogger } from "@otterdeploy/logger";
import { getDockerClient } from "./client";

const log = createLogger("docker:events");

export interface ContainerDeathEvent {
  /** Docker container ID */
  containerId: string;
  /** Docker event action: "die", "stop", or "kill" */
  action: "die" | "stop" | "kill";
  /** Swarm service name (e.g. "otterstack-abc123") */
  serviceName: string;
  /** Unix timestamp (seconds) */
  time: number;
}

export type ContainerDeathCallback = (event: ContainerDeathEvent) => void;

const DEATH_ACTIONS = new Set(["die", "stop", "kill"]);
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

export function watchContainerEvents(
  callback: ContainerDeathCallback,
): { stop: () => void } {
  let stopped = false;
  let currentStream: NodeJS.ReadableStream | null = null;
  let reconnectMs = INITIAL_RECONNECT_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    if (stopped) return;

    try {
      const docker = getDockerClient();
      const stream = await docker.getEvents({
        filters: {
          type: ["container"],
          event: ["die", "stop", "kill"],
        },
      });

      currentStream = stream;
      reconnectMs = INITIAL_RECONNECT_MS;
      log.info("Docker event stream connected");

      stream.on("data", (chunk: Buffer) => {
        try {
          const event = JSON.parse(chunk.toString());
          if (
            event.Type !== "container" ||
            !DEATH_ACTIONS.has(event.Action)
          ) {
            return;
          }

          // Only process Swarm-managed containers (they have this label)
          const serviceName =
            event.Actor?.Attributes?.["com.docker.swarm.service.name"];
          if (!serviceName || !serviceName.startsWith("otterstack-")) {
            return;
          }

          callback({
            containerId: event.Actor?.ID ?? event.id,
            action: event.Action as "die" | "stop" | "kill",
            serviceName,
            time: event.time ?? Math.floor(Date.now() / 1000),
          });
        } catch (parseErr) {
          log.warn({ err: parseErr }, "Failed to parse Docker event");
        }
      });

      stream.on("error", (err: Error) => {
        log.error({ err }, "Docker event stream error");
        scheduleReconnect();
      });

      stream.on("end", () => {
        log.warn("Docker event stream ended");
        scheduleReconnect();
      });
    } catch (err) {
      log.error({ err }, "Failed to connect to Docker event stream");
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    destroyStream();

    log.info({ reconnectMs }, "Scheduling Docker event stream reconnect");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);

    reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
  }

  function destroyStream() {
    if (currentStream) {
      try {
        currentStream.removeAllListeners();
        if ("destroy" in currentStream && typeof (currentStream as any).destroy === "function") {
          (currentStream as any).destroy();
        }
      } catch {
        // ignore cleanup errors
      }
      currentStream = null;
    }
  }

  // Start initial connection
  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      destroyStream();
      log.info("Docker event watcher stopped");
    },
  };
}
```

**Step 2: Export from `packages/docker/src/index.ts`**

Add these lines to `packages/docker/src/index.ts`:

```typescript
export {
  watchContainerEvents,
} from "./events";
export type {
  ContainerDeathEvent,
  ContainerDeathCallback,
} from "./events";
```

**Step 3: Verify types compile**

Run: `cd packages/docker && npx tsc --noEmit`
Expected: No errors from the new file.

**Step 4: Commit**

```bash
git add packages/docker/src/events.ts packages/docker/src/index.ts
git commit -m "feat: add Docker event stream watcher for container death events"
```

---

### Task 2: Create resource health watcher service

**Files:**
- Create: `apps/worker/src/services/resource-health-watcher.ts`

**Step 1: Create the health watcher service**

This module ties the Docker event stream to DB updates. It debounces rapid events per service, checks remaining containers, and updates resource status.

```typescript
import { createLogger } from "@otterdeploy/logger";
import {
  watchContainerEvents,
  listContainers,
  type ContainerDeathEvent,
} from "@otterdeploy/docker";
import { db, eq, and, isNull, inArray } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { publishEvent } from "@otterdeploy/events";

const log = createLogger("resource-health-watcher");

const DEBOUNCE_MS = 2_000;

export function startResourceHealthWatcher(): { stop: () => void } {
  const pendingChecks = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = watchContainerEvents((event: ContainerDeathEvent) => {
    const { serviceName } = event;

    log.info(
      { action: event.action, serviceName, containerId: event.containerId },
      "Container death event received",
    );

    // Debounce: if we already have a pending check for this service, reset the timer.
    // This batches rapid container deaths (e.g. multi-replica scale-down).
    const existing = pendingChecks.get(serviceName);
    if (existing) clearTimeout(existing);

    pendingChecks.set(
      serviceName,
      setTimeout(() => {
        pendingChecks.delete(serviceName);
        handleServiceDeath(serviceName).catch((err) => {
          log.error({ err, serviceName }, "Failed to handle service death");
        });
      }, DEBOUNCE_MS),
    );
  });

  function stop() {
    // Clear all pending debounce timers
    for (const timer of pendingChecks.values()) {
      clearTimeout(timer);
    }
    pendingChecks.clear();
    watcher.stop();
    log.info("Resource health watcher stopped");
  }

  log.info("Resource health watcher started");
  return { stop };
}

async function handleServiceDeath(serviceName: string): Promise<void> {
  // Extract resource ID from service name: "otterstack-{resourceId}"
  const resourceId = serviceName.replace(/^otterstack-/, "");
  if (!resourceId || resourceId === serviceName) {
    log.warn({ serviceName }, "Could not extract resource ID from service name");
    return;
  }

  // Look up the resource in DB
  const row = await db.query.resource.findFirst({
    where: and(
      eq(resource.id, resourceId),
      isNull(resource.deletedAt),
    ),
  });

  if (!row) {
    log.debug({ resourceId }, "Resource not found in DB, skipping");
    return;
  }

  // Skip resources that are currently deploying (deployment pipeline owns their status)
  if (row.status === "deploying") {
    log.debug({ resourceId, status: row.status }, "Resource is deploying, skipping health update");
    return;
  }

  // Skip resources already marked as crashed or stopped
  if (row.status === "crashed" || row.status === "stopped") {
    log.debug({ resourceId, status: row.status }, "Resource already in terminal status, skipping");
    return;
  }

  // Check remaining containers for this service
  const containersResult = await listContainers(serviceName);
  if (containersResult.isErr()) {
    log.error(
      { err: containersResult.error, serviceName },
      "Failed to list containers for health check",
    );
    return;
  }

  const containers = containersResult.value;
  const running = containers.filter((c) => c.state === "running");

  let nextStatus: "crashed" | "degraded";
  if (running.length > 0) {
    // Some containers still running — service is degraded
    nextStatus = "degraded";
  } else {
    // No running containers — service has crashed
    nextStatus = "crashed";
  }

  // Only update if status actually changed
  if (row.status === nextStatus) {
    log.debug({ resourceId, status: nextStatus }, "Status unchanged, skipping update");
    return;
  }

  const previousStatus = row.status;

  // Update DB
  await db
    .update(resource)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(resource.id, resourceId));

  log.info(
    { resourceId, previousStatus, nextStatus, runningContainers: running.length },
    "Resource status updated",
  );

  // Emit health changed event
  const publishResult = await publishEvent("resource.health.changed", {
    orgId: row.organizationId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    resourceId: row.id,
    previousStatus,
    nextStatus,
  });

  if (publishResult.isErr()) {
    log.error(
      { err: publishResult.error, resourceId },
      "Failed to publish resource.health.changed event",
    );
  }
}
```

**Step 2: Verify types compile**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: No errors from the new file.

**Step 3: Commit**

```bash
git add apps/worker/src/services/resource-health-watcher.ts
git commit -m "feat: add resource health watcher service with debounced Docker event processing"
```

---

### Task 3: Start the health watcher on worker boot

**Files:**
- Modify: `apps/worker/src/index.ts:1-22`

**Step 1: Add the watcher startup to `apps/worker/src/index.ts`**

After the existing app setup, import and start the health watcher. Add graceful shutdown on SIGTERM/SIGINT.

The file currently looks like:

```typescript
import { Hono } from "hono";
import { serve } from "inngest/hono";
import { createLogger } from "@otterdeploy/logger";

import { inngest } from "./inngest";
import { functions } from "./functions";

const logger = createLogger("worker");

const app = new Hono();

app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({ client: inngest, functions }),
);

app.get("/", (c) => c.text("Worker OK"));

logger.info("Inngest worker started");

export default app;
```

Change it to:

```typescript
import { Hono } from "hono";
import { serve } from "inngest/hono";
import { createLogger } from "@otterdeploy/logger";

import { inngest } from "./inngest";
import { functions } from "./functions";
import { startResourceHealthWatcher } from "./services/resource-health-watcher";

const logger = createLogger("worker");

const app = new Hono();

app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({ client: inngest, functions }),
);

app.get("/", (c) => c.text("Worker OK"));

// Start background Docker event stream listener for resource health monitoring
const healthWatcher = startResourceHealthWatcher();

// Graceful shutdown
const shutdown = () => {
  logger.info("Shutting down health watcher...");
  healthWatcher.stop();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info("Inngest worker started");

export default app;
```

**Step 2: Verify types compile**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: No errors.

**Step 3: Test manually**

1. Start the dev environment: `bun run dev`
2. Deploy a test service through the UI
3. Verify it shows as "online" in the dashboard
4. Kill the container externally: `docker kill <container_id>`
5. Within ~2 seconds, the dashboard should show the service as "crashed"

**Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: start resource health watcher on worker boot with graceful shutdown"
```

---

## Summary

| Task | File(s) | What it does |
|------|---------|--------------|
| 1 | `packages/docker/src/events.ts`, `packages/docker/src/index.ts` | Low-level Docker event stream with reconnection |
| 2 | `apps/worker/src/services/resource-health-watcher.ts` | Business logic: debounce, check containers, update DB, emit events |
| 3 | `apps/worker/src/index.ts` | Wire it up on worker boot with graceful shutdown |
