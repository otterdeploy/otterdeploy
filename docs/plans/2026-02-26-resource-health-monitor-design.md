# Resource Health Monitor — Design

## Problem

When Docker services are killed outside the UI (e.g. `docker kill`, `docker stop`, OOM), the dashboard still shows them as "online". Status is only updated during the deployment pipeline — no ongoing monitoring exists.

## Solution

A Docker event stream listener that runs as a background process inside the worker. It subscribes to container lifecycle events in real-time and updates resource status when containers die.

## Architecture

```
Worker boots (index.ts)
  └─ Starts DockerHealthWatcher (background)
       └─ Subscribes to docker.getEvents() stream
            │
            ├─ Container "die" event
            ├─ Container "stop" event
            └─ Container "kill" event
                 │
                 ├─ Extract Swarm service name from container labels
                 ├─ Look up resource by service name (otterstack-{resourceId})
                 ├─ Skip if resource status is "deploying"
                 ├─ Check if ALL containers for that service are dead
                 ├─ Update DB: status → "crashed" or "degraded"
                 └─ Emit "resource.health.changed" event via Inngest
```

## New Files

### 1. `packages/docker/src/events.ts`

Low-level Docker event stream. Uses `dockerode.getEvents()` filtered to container events (die, stop, kill). Parses events, extracts otterstack labels, and invokes a callback. Handles reconnection with exponential backoff on stream errors.

Exports:
- `watchContainerEvents(callback)` → returns `{ stop(): void }`

### 2. `apps/worker/src/services/resource-health-watcher.ts`

Business logic layer. Receives parsed Docker events and:
1. Extracts the resource ID from the Swarm service name (`otterstack-{resourceId}`)
2. Queries DB for the resource's current status
3. Skips resources with status `deploying` (deployment pipeline owns those)
4. Calls `listContainers()` to check if ALL containers for the service are dead
5. Updates DB status to `crashed` (all dead) or `degraded` (some dead)
6. Emits `resource.health.changed` event via Inngest client

Exports:
- `startResourceHealthWatcher(inngest)` → returns `{ stop(): void }`

### 3. Modify `apps/worker/src/index.ts`

Start the watcher on worker boot. Call `startResourceHealthWatcher(inngest)` after app setup.

## Key Behaviors

- **Only reacts to death events** — die, stop, kill. Not start/create (deployment pipeline handles those).
- **Checks all containers** before marking crashed — if one replica dies but others run, marks `degraded`.
- **Skips deploying resources** — the deployment pipeline owns status transitions during deploys.
- **Auto-reconnects** — exponential backoff (1s, 2s, 4s... up to 30s) on stream errors.
- **Graceful shutdown** — cleans up stream on SIGTERM/SIGINT.
- **Debounces** — brief delay (2s) after an event before checking, to batch rapid container deaths (e.g. service scale-down).

## Status Mapping

| Scenario | New Status |
|----------|-----------|
| All containers dead/exited | `crashed` |
| Some containers dead, some running | `degraded` |
| Resource is `deploying` | skip (no change) |
| Resource is already `crashed` | skip (no change) |

## What This Does NOT Do

- No cron polling — pure event-driven.
- No recovery detection (crashed → online). Redeployment handles that.
- No remote Docker support — local socket only (matches current architecture).
