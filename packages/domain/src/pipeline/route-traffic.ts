import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

const log = createLogger("pipeline:route-traffic");

export interface RouteTrafficDeps {
  /**
   * Sync the Caddy reverse proxy routes for a resource.
   */
  syncResourceProxy: (
    resourceId: string,
    deps: {
      getResourceDomains: (
        resourceId: string,
      ) => Promise<Array<{ domain: string; verified: boolean }>>;
      getResourcePort: (resourceId: string) => Promise<number>;
    },
  ) => Promise<Result<void, Error>>;

  /**
   * Get verified domains for a resource.
   */
  getResourceDomains: (
    resourceId: string,
  ) => Promise<Array<{ domain: string; verified: boolean }>>;

  /**
   * Get the port for a resource.
   */
  getResourcePort: (resourceId: string) => Promise<number>;
}

/**
 * Step 8: Route traffic.
 * - Pushes updated Caddy reverse proxy routes for the resource.
 * - Only routes to verified custom domains.
 *
 * Idempotent: Caddy routes are upserted (update or add).
 */
export async function routeTraffic(
  input: {
    deploymentId: string;
    resourceId: string;
  },
  deps: RouteTrafficDeps,
): Promise<Result<void, Error>> {
  try {
    const result = await deps.syncResourceProxy(input.resourceId, {
      getResourceDomains: deps.getResourceDomains,
      getResourcePort: deps.getResourcePort,
    });

    if (result.isErr()) {
      log.warn(
        { err: result.error, deploymentId: input.deploymentId, resourceId: input.resourceId },
        "Failed to sync proxy routes (non-fatal for resources without domains)",
      );
      // Non-fatal: resource may not have any custom domains configured
      // The service is still accessible via internal Docker networking
      return Result.ok(undefined);
    }

    log.info(
      { deploymentId: input.deploymentId, resourceId: input.resourceId },
      "Traffic routes updated",
    );
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, deploymentId: input.deploymentId }, "Route traffic failed");
    return Result.err(err);
  }
}
