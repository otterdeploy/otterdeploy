import { createLogger } from "@otterdeploy/logger";
import {
  watchContainerEvents,
  listContainers,
  listServices,
  type ContainerDeathEvent,
} from "@otterdeploy/docker";
import { db, eq, and, isNull, inArray } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { publishEvent } from "@otterdeploy/events";

const log = createLogger("resource-health-watcher");

const DEBOUNCE_MS = 2_000;

/** Statuses that are owned by other processes and should not be overwritten. */
const SKIP_STATUSES = new Set(["deploying", "crashed", "stopped"]);

/** Statuses that indicate a resource should be running. */
const ACTIVE_STATUSES = ["online", "degraded"] as const;

type ResourceStatus =
  | "online"
  | "degraded"
  | "crashed"
  | "deploying"
  | "stopped"
  | "unknown";

/**
 * Reconcile all resources marked online/degraded against actual Docker state.
 * Marks resources as "crashed" if their Docker service no longer exists.
 * Called on startup and periodically by the cron job.
 */
export async function reconcileResourceHealth(): Promise<void> {
  // Find all resources that claim to be running
  const activeResources = await db.query.resource.findMany({
    where: and(
      inArray(resource.status, [...ACTIVE_STATUSES]),
      isNull(resource.deletedAt),
    ),
  });

  if (activeResources.length === 0) {
    log.debug("No active resources to reconcile");
    return;
  }

  // Get all otterstack Docker services in one call
  const servicesResult = await listServices();
  if (servicesResult.isErr()) {
    log.error({ err: servicesResult.error }, "Failed to list Docker services during reconciliation");
    return;
  }

  // Build a set of resource IDs that have a running Docker service
  const liveResourceIds = new Set<string>();
  for (const service of servicesResult.value) {
    const resourceId = service.labels["otterstack.resource.id"];
    if (resourceId) {
      liveResourceIds.add(resourceId);
    }
  }

  let updatedCount = 0;

  for (const row of activeResources) {
    if (liveResourceIds.has(row.id)) {
      // Service exists — check container health for degraded detection
      const containersResult = await listContainers(`otterstack-${row.id}`);
      if (containersResult.isOk()) {
        const running = containersResult.value.filter((c) => c.state === "running");
        if (running.length === 0) {
          // Service exists but no running containers
          await updateResourceStatus(row, "crashed");
          updatedCount++;
        } else if (row.status === "online" && running.length < (servicesResult.value.find(
          (s) => s.labels["otterstack.resource.id"] === row.id,
        )?.replicas ?? 1)) {
          // Some containers down
          await updateResourceStatus(row, "degraded");
          updatedCount++;
        }
      }
    } else {
      // No Docker service at all — resource is crashed
      await updateResourceStatus(row, "crashed");
      updatedCount++;
    }
  }

  log.info(
    { checkedCount: activeResources.length, updatedCount },
    "Resource health reconciliation complete",
  );
}

async function updateResourceStatus(
  row: typeof resource.$inferSelect,
  nextStatus: ResourceStatus,
): Promise<void> {
  const previousStatus = row.status as ResourceStatus;
  if (previousStatus === nextStatus) return;

  // Optimistic lock
  await db
    .update(resource)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(
      and(
        eq(resource.id, row.id),
        eq(resource.status, previousStatus),
      ),
    );

  log.info(
    { resourceId: row.id, previousStatus, nextStatus },
    "Resource status updated via reconciliation",
  );

  const result = await publishEvent("resource.health.changed", {
    orgId: row.organizationId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    resourceId: row.id,
    previousStatus,
    nextStatus,
  });

  if (result.isErr()) {
    log.error(
      { err: result.error, resourceId: row.id },
      "Failed to publish resource.health.changed event",
    );
  }
}

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
