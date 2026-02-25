import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import type { CaddyConfig, CaddyRoute } from "./types";

const log = createLogger("proxy:caddy-client");

const CADDY_ADMIN_URL = "http://127.0.0.1:2019";

export async function getConfig(): Promise<Result<CaddyConfig, Error>> {
  try {
    const response = await fetch(`${CADDY_ADMIN_URL}/config/`);
    if (!response.ok) {
      return Result.err(
        new Error(`Failed to get config: ${response.status} ${response.statusText}`),
      );
    }
    const config = (await response.json()) as CaddyConfig;
    return Result.ok(config);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to get Caddy config");
    return Result.err(err);
  }
}

export async function addRoute(
  route: CaddyRoute,
  serverKey = "srv0",
): Promise<Result<void, Error>> {
  try {
    const response = await fetch(
      `${CADDY_ADMIN_URL}/config/apps/http/servers/${serverKey}/routes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(route),
      },
    );
    if (!response.ok) {
      return Result.err(
        new Error(`Failed to add route: ${response.status} ${response.statusText}`),
      );
    }
    log.info({ routeId: route["@id"] }, "Route added");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to add route");
    return Result.err(err);
  }
}

export async function removeRouteById(
  routeId: string,
): Promise<Result<void, Error>> {
  try {
    const response = await fetch(`${CADDY_ADMIN_URL}/id/${routeId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      return Result.err(
        new Error(
          `Failed to remove route: ${response.status} ${response.statusText}`,
        ),
      );
    }
    log.info({ routeId }, "Route removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, routeId }, "Failed to remove route");
    return Result.err(err);
  }
}

export async function updateRoute(
  routeId: string,
  route: CaddyRoute,
): Promise<Result<void, Error>> {
  try {
    const response = await fetch(`${CADDY_ADMIN_URL}/id/${routeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(route),
    });
    if (!response.ok) {
      return Result.err(
        new Error(
          `Failed to update route: ${response.status} ${response.statusText}`,
        ),
      );
    }
    log.info({ routeId }, "Route updated");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, routeId }, "Failed to update route");
    return Result.err(err);
  }
}

export async function loadConfig(
  config: CaddyConfig,
): Promise<Result<void, Error>> {
  try {
    const response = await fetch(`${CADDY_ADMIN_URL}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      return Result.err(
        new Error(
          `Failed to load config: ${response.status} ${response.statusText}`,
        ),
      );
    }
    log.info("Full config loaded");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to load Caddy config");
    return Result.err(err);
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${CADDY_ADMIN_URL}/config/`);
    return response.status === 200;
  } catch {
    return false;
  }
}
