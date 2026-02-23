import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

const log = createLogger("pipeline:health-check");

export interface HealthCheckDeps {
  /**
   * List containers for a given service filter.
   */
  listContainers: (serviceFilter: string) => Promise<
    Result<Array<{ id: string; state: string; status: string }>, Error>
  >;

  /**
   * Wait for a specified number of milliseconds.
   */
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 5_000;

/**
 * Step 7: Health check.
 * - Polls Docker container health status for the deployed service.
 * - Waits until at least one container is in "running" state.
 * - Times out after 120s (configurable).
 *
 * Idempotent: polling is naturally idempotent and safe to re-run.
 */
export async function waitForHealthy(
  input: {
    deploymentId: string;
    resourceId: string;
    timeoutMs?: number;
    intervalMs?: number;
  },
  deps: HealthCheckDeps,
): Promise<Result<void, Error>> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;
  const serviceName = `otterstack-${input.resourceId}`;
  const startTime = Date.now();

  log.info(
    { deploymentId: input.deploymentId, serviceName, timeoutMs, intervalMs },
    "Starting health check polling",
  );

  while (Date.now() - startTime < timeoutMs) {
    const containersResult = await deps.listContainers(serviceName);

    if (containersResult.isOk()) {
      const containers = containersResult.value;
      const running = containers.filter((c) => c.state === "running");

      if (running.length > 0) {
        log.info(
          {
            deploymentId: input.deploymentId,
            runningCount: running.length,
            elapsed: Date.now() - startTime,
          },
          "Health check passed",
        );
        return Result.ok(undefined);
      }

      // Check for crashed containers
      const dead = containers.filter(
        (c) => c.state === "exited" || c.state === "dead",
      );
      if (dead.length > 0 && running.length === 0) {
        return Result.err(
          new Error(
            `All containers exited or dead for ${serviceName}: ${dead.map((c) => `${c.id.slice(0, 12)} (${c.state})`).join(", ")}`,
          ),
        );
      }
    } else {
      log.warn(
        { err: containersResult.error, deploymentId: input.deploymentId },
        "Failed to list containers during health check (will retry)",
      );
    }

    await deps.sleep(intervalMs);
  }

  return Result.err(
    new Error(
      `Health check timed out after ${timeoutMs}ms for service ${serviceName}`,
    ),
  );
}
