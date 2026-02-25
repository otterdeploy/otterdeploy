import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import { getDockerClient } from "./client";
import type { SwarmInitResult, NetworkCreateResult } from "./types";

const log = createLogger("docker:swarm");

const INGRESS_NETWORK_NAME = "otterstack-ingress";

export async function isSwarmActive(): Promise<boolean> {
  const docker = getDockerClient();
  try {
    const info = await docker.swarmInspect();
    return !!info?.ID;
  } catch {
    return false;
  }
}

export async function initSwarm(): Promise<Result<SwarmInitResult, Error>> {
  const docker = getDockerClient();

  try {
    const active = await isSwarmActive();
    if (active) {
      const info = await docker.swarmInspect();
      log.info("Swarm already active, skipping init");
      return Result.ok({
        nodeId: info.ID,
        alreadyActive: true,
      });
    }

    log.info("Initializing Docker Swarm on 127.0.0.1:2377");
    const result = await docker.swarmInit({
      ListenAddr: "127.0.0.1:2377",
    });

    log.info({ nodeId: result }, "Swarm initialized successfully");
    return Result.ok({
      nodeId: result,
      alreadyActive: false,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to initialize Swarm");
    return Result.err(err);
  }
}

export async function createIngressNetwork(): Promise<
  Result<NetworkCreateResult, Error>
> {
  const docker = getDockerClient();

  try {
    const networks = await docker.listNetworks({
      filters: { name: [INGRESS_NETWORK_NAME] },
    });

    const existing = networks.find((n) => n.Name === INGRESS_NETWORK_NAME);
    if (existing) {
      log.info(
        { networkId: existing.Id },
        "Ingress network already exists, skipping creation",
      );
      return Result.ok({
        networkId: existing.Id,
        alreadyExists: true,
      });
    }

    log.info("Creating otterstack-ingress overlay network");
    const network = await docker.createNetwork({
      Name: INGRESS_NETWORK_NAME,
      Driver: "overlay",
      Attachable: true,
      Labels: {
        "otterstack.managed": "true",
        "otterstack.network.role": "ingress",
      },
    });

    log.info({ networkId: network.id }, "Ingress network created");
    return Result.ok({
      networkId: network.id,
      alreadyExists: false,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to create ingress network");
    return Result.err(err);
  }
}
