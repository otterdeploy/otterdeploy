import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { addRoute, updateRoute, removeRouteById, loadConfig } from "./caddy-client";
import { buildRoute, buildRouteId } from "./config-builder";
import type { CaddyConfig, RouteTarget } from "./types";

const log = createLogger("proxy:sync");

export interface SyncDeps {
  getResourceDomains: (
    resourceId: string,
  ) => Promise<Array<{ domain: string; verified: boolean }>>;
  getResourcePort: (resourceId: string) => Promise<number>;
  getAllResources: () => Promise<
    Array<{ id: string; port: number; domains: Array<{ domain: string }> }>
  >;
}

export async function syncResourceProxy(
  resourceId: string,
  deps: SyncDeps,
): Promise<Result<void, Error>> {
  try {
    const domains = await deps.getResourceDomains(resourceId);
    const port = await deps.getResourcePort(resourceId);

    const verifiedDomains = domains.filter((d) => d.verified);

    for (const { domain } of verifiedDomains) {
      const target: RouteTarget = {
        resourceId,
        domain,
        upstream: `otterstack-${resourceId}`,
        port,
      };

      const route = buildRoute(target);
      const routeId = buildRouteId(resourceId, domain);

      const result = await updateRoute(routeId, route);
      if (result.isErr()) {
        log.warn(
          { err: result.error, resourceId, domain },
          "Update failed, attempting add",
        );
        const addResult = await addRoute(route);
        if (addResult.isErr()) {
          return Result.err(addResult.error);
        }
      }
    }

    log.info(
      { resourceId, domainCount: verifiedDomains.length },
      "Resource proxy synced",
    );
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, resourceId }, "Failed to sync resource proxy");
    return Result.err(err);
  }
}

export async function syncDomainProxy(
  resourceId: string,
  domain: string,
  port: number,
): Promise<Result<void, Error>> {
  try {
    const target: RouteTarget = {
      resourceId,
      domain,
      upstream: `otterstack-${resourceId}`,
      port,
    };

    const route = buildRoute(target);
    const result = await addRoute(route);
    if (result.isErr()) {
      return Result.err(result.error);
    }

    log.info({ resourceId, domain }, "Domain proxy synced");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, resourceId, domain }, "Failed to sync domain proxy");
    return Result.err(err);
  }
}

export async function removeResourceProxy(
  resourceId: string,
  domains: string[],
): Promise<Result<void, Error>> {
  try {
    for (const domain of domains) {
      const routeId = buildRouteId(resourceId, domain);
      const result = await removeRouteById(routeId);
      if (result.isErr()) {
        log.warn(
          { err: result.error, routeId },
          "Failed to remove route (may not exist)",
        );
      }
    }

    log.info(
      { resourceId, domainCount: domains.length },
      "Resource proxy removed",
    );
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, resourceId }, "Failed to remove resource proxy");
    return Result.err(err);
  }
}

export async function syncServerProxy(
  deps: SyncDeps,
): Promise<Result<void, Error>> {
  try {
    const resources = await deps.getAllResources();

    const allRoutes = resources.flatMap((resource) =>
      resource.domains.map((d) => {
        const target: RouteTarget = {
          resourceId: resource.id,
          domain: d.domain,
          upstream: `otterstack-${resource.id}`,
          port: resource.port,
        };
        return buildRoute(target);
      }),
    );

    const config: CaddyConfig = {
      admin: { listen: "127.0.0.1:2019" },
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [":443"],
              routes: allRoutes,
            },
          },
        },
      },
    };

    const result = await loadConfig(config);
    if (result.isErr()) {
      return Result.err(result.error);
    }

    log.info(
      { resourceCount: resources.length, routeCount: allRoutes.length },
      "Full server proxy synced",
    );
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to sync server proxy");
    return Result.err(err);
  }
}
