import { createLogger } from "@otterdeploy/logger";
import {
  watchContainerEvents,
  listContainers,
  type ContainerDeathEvent,
} from "@otterdeploy/docker";
import { db, eq, and, isNull } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { publishEvent } from "@otterdeploy/events";

const log = createLogger("resource-health-watcher");

const DEBOUNCE_MS = 2_000;

/** Statuses that are owned by other processes and should not be overwritten. */
const SKIP_STATUSES = new Set(["deploying", "crashed", "stopped"]);

type ResourceStatus =
  | "online"
  | "degraded"
  | "crashed"
  | "deploying"
  | "stopped"
  | "unknown";

export function startResourceHealthWatcher(): { stop: () => void } {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function handleServiceEvent(serviceName: string) {
    const resourceId = serviceName.replace(/^otterstack-/, "");
    if (!resourceId || resourceId === serviceName) {
      log.warn({ serviceName }, "Could not extract resource ID from service name");
      return;
    }

    log.debug({ serviceName, resourceId }, "Processing debounced health event");

    // Query DB for the resource
    const row = await db.query.resource.findFirst({
      where: and(eq(resource.id, resourceId), isNull(resource.deletedAt)),
    });

    if (!row) {
      log.warn({ resourceId }, "Resource not found or deleted, skipping");
      return;
    }

    // Skip statuses owned by other processes
    if (SKIP_STATUSES.has(row.status)) {
      log.debug(
        { resourceId, status: row.status },
        "Skipping resource in non-watchable status",
      );
      return;
    }

    // Check remaining running containers
    const containersResult = await listContainers(serviceName);

    if (containersResult.isErr()) {
      log.error(
        { err: containersResult.error, serviceName },
        "Failed to list containers for service",
      );
      return;
    }

    const containers = containersResult.value;
    const running = containers.filter((c) => c.state === "running");

    let nextStatus: ResourceStatus;
    if (running.length > 0) {
      nextStatus = "degraded";
    } else {
      nextStatus = "crashed";
    }

    // Only update if status actually changed
    const previousStatus = row.status as ResourceStatus;
    if (previousStatus === nextStatus) {
      log.debug(
        { resourceId, status: nextStatus },
        "Status unchanged, skipping update",
      );
      return;
    }

    log.info(
      { resourceId, previousStatus, nextStatus },
      "Updating resource health status",
    );

    // Optimistic lock: only update if status hasn't been changed by another process
    // (e.g. a concurrent deployment setting status to "deploying")
    await db
      .update(resource)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(
        and(
          eq(resource.id, resourceId),
          eq(resource.status, previousStatus),
        ),
      );

    const result = await publishEvent("resource.health.changed", {
      orgId: row.organizationId,
      projectId: row.projectId,
      environmentId: row.environmentId,
      resourceId,
      previousStatus,
      nextStatus,
    });

    if (result.isErr()) {
      log.error(
        { err: result.error, resourceId },
        "Failed to publish resource.health.changed event",
      );
    }
  }

  function onContainerDeath(event: ContainerDeathEvent) {
    const { serviceName } = event;

    log.debug(
      { serviceName, action: event.action, containerId: event.containerId },
      "Received container death event",
    );

    // Clear any existing debounce timer for this service
    const existing = debounceTimers.get(serviceName);
    if (existing) {
      clearTimeout(existing);
    }

    // Set a new debounce timer — wait for rapid events to settle
    const timer = setTimeout(() => {
      debounceTimers.delete(serviceName);
      handleServiceEvent(serviceName).catch((err) => {
        log.error(
          { err, serviceName },
          "Unhandled error processing health event",
        );
      });
    }, DEBOUNCE_MS);

    debounceTimers.set(serviceName, timer);
  }

  const watcher = watchContainerEvents(onContainerDeath);

  log.info("Resource health watcher started");

  return {
    stop() {
      // Clear all pending debounce timers
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();

      watcher.stop();
      log.info("Resource health watcher stopped");
    },
  };
}
