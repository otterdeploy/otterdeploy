import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";
import { createService, inspectService, removeService } from "@otterdeploy/docker";
import { healthCheck } from "./caddy-client";

const log = createLogger("proxy:container");

const CADDY_SERVICE_NAME = "otterstack-caddy";

export function getCaddyServiceName(): string {
  return CADDY_SERVICE_NAME;
}

export async function bootstrapCaddy(): Promise<Result<string, Error>> {
  try {
    const result = await createService({
      name: CADDY_SERVICE_NAME,
      image: "caddy:2-alpine",
      volumes: [
        { source: "otterstack-caddy-data", target: "/data", type: "volume" },
        {
          source: "otterstack-caddy-config",
          target: "/config",
          type: "volume",
        },
      ],
      ports: [
        { target: 80, published: 80 },
        { target: 443, published: 443 },
      ],
      networks: ["otterstack-ingress"],
      labels: {
        "otterstack.managed": "true",
        "otterstack.network.role": "ingress",
        "otterstack.resource.id": "caddy",
        "otterstack.project.id": "system",
        "otterstack.environment.id": "system",
        "otterstack.organization.id": "system",
      },
      replicas: 1,
    });

    if (result.isErr()) {
      return Result.err(result.error);
    }

    log.info({ serviceId: result.unwrap() }, "Caddy service bootstrapped");
    return Result.ok(result.unwrap());
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to bootstrap Caddy");
    return Result.err(err);
  }
}

export async function isCaddyRunning(): Promise<boolean> {
  try {
    const inspectResult = await inspectService(CADDY_SERVICE_NAME);
    if (inspectResult.isErr()) {
      return false;
    }

    const healthy = await healthCheck();
    return healthy;
  } catch {
    return false;
  }
}

export async function restartCaddy(): Promise<Result<void, Error>> {
  try {
    // Remove existing service
    const removeResult = await removeService(CADDY_SERVICE_NAME);
    if (removeResult.isErr()) {
      log.warn(
        { err: removeResult.error },
        "Failed to remove existing Caddy service (may not exist)",
      );
    }

    // Recreate
    const createResult = await bootstrapCaddy();
    if (createResult.isErr()) {
      return Result.err(createResult.error);
    }

    log.info("Caddy service restarted");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to restart Caddy");
    return Result.err(err);
  }
}
