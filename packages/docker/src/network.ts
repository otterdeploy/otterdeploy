import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import { getDockerClient } from "./client";
import type { NetworkCreateResult } from "./types";

const log = createLogger("docker:network");

function projectNetworkName(projectId: string, environmentId?: string): string {
  // Docker limits names to 63 characters; truncate UUIDs to first 8 chars
  const projShort = projectId.slice(0, 8);
  const envShort = environmentId?.slice(0, 8);
  return envShort
    ? `otterstack-proj-${projShort}-env-${envShort}`
    : `otterstack-proj-${projShort}`;
}

function policyNetworkName(
  projectId: string,
  environmentId: string,
  policyName: string,
): string {
  const projShort = projectId.slice(0, 8);
  const envShort = environmentId.slice(0, 8);
  return `otterstack-${projShort}-${envShort}-${policyName}`;
}

async function findCaddyService(
  docker: import("dockerode"),
): Promise<import("dockerode").Service | null> {
  try {
    const services = await docker.listServices({
      filters: { label: ["otterstack.network.role=ingress"] },
    });

    if (services.length > 0) {
      return docker.getService((services[0] as any).ID);
    }

    // Fallback: try by name
    try {
      const service = docker.getService("otterstack-caddy");
      await service.inspect();
      return service;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function connectServiceToNetworkById(
  docker: import("dockerode"),
  serviceId: string,
  networkName: string,
): Promise<void> {
  const service = docker.getService(serviceId);
  const inspection = await service.inspect();
  const currentSpec = inspection.Spec;
  const version = inspection.Version.Index;

  const existingNetworks: Array<{ Target: string }> =
    currentSpec.TaskTemplate.Networks ?? [];
  const alreadyConnected = existingNetworks.some(
    (n) => n.Target === networkName,
  );
  if (alreadyConnected) return;

  const updatedSpec = {
    ...currentSpec,
    TaskTemplate: {
      ...currentSpec.TaskTemplate,
      Networks: [...existingNetworks, { Target: networkName }],
    },
  };

  await service.update({ ...updatedSpec, version } as any);
}

async function disconnectServiceFromNetworkById(
  docker: import("dockerode"),
  serviceId: string,
  networkName: string,
): Promise<void> {
  const service = docker.getService(serviceId);
  const inspection = await service.inspect();
  const currentSpec = inspection.Spec;
  const version = inspection.Version.Index;

  const existingNetworks: Array<{ Target: string }> =
    currentSpec.TaskTemplate.Networks ?? [];
  const filtered = existingNetworks.filter((n) => n.Target !== networkName);

  if (filtered.length === existingNetworks.length) return;

  const updatedSpec = {
    ...currentSpec,
    TaskTemplate: {
      ...currentSpec.TaskTemplate,
      Networks: filtered,
    },
  };

  await service.update({ ...updatedSpec, version } as any);
}

export async function createProjectNetwork(
  projectId: string,
  environmentId?: string,
): Promise<Result<NetworkCreateResult, Error>> {
  const docker = getDockerClient();
  const networkName = projectNetworkName(projectId, environmentId);

  try {
    // Check if network already exists
    const networks = await docker.listNetworks({
      filters: { name: [networkName] },
    });
    const existing = networks.find((n) => n.Name === networkName);

    if (existing) {
      log.info(
        { networkId: existing.Id, projectId },
        "Project network already exists",
      );
      return Result.ok({ networkId: existing.Id, alreadyExists: true });
    }

    // Create overlay network (encrypted, attachable)
    const network = await docker.createNetwork({
      Name: networkName,
      Driver: "overlay",
      Attachable: true,
      Options: { encrypted: "true" },
      Labels: {
        "otterstack.managed": "true",
        "otterstack.project.id": projectId,
        ...(environmentId ? { "otterstack.environment.id": environmentId } : {}),
        "otterstack.network.role": "project",
      },
    });

    log.info({ networkId: network.id, projectId }, "Project network created");

    // Connect Caddy service to the new network
    const caddy = await findCaddyService(docker);
    if (caddy) {
      const caddyInfo = await caddy.inspect();
      try {
        await connectServiceToNetworkById(docker, caddyInfo.ID, networkName);
        log.info({ projectId }, "Caddy connected to project network");
      } catch (connectErr) {
        log.warn(
          { err: connectErr, projectId },
          "Failed to connect Caddy to project network",
        );
      }
    }

    return Result.ok({ networkId: network.id, alreadyExists: false });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, projectId }, "Failed to create project network");
    return Result.err(err);
  }
}

export async function removeProjectNetwork(
  projectId: string,
  environmentId?: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();
  const networkName = projectNetworkName(projectId, environmentId);

  try {
    // Disconnect Caddy first
    const caddy = await findCaddyService(docker);
    if (caddy) {
      const caddyInfo = await caddy.inspect();
      try {
        await disconnectServiceFromNetworkById(docker, caddyInfo.ID, networkName);
        log.info({ projectId }, "Caddy disconnected from project network");
      } catch (disconnectErr) {
        log.warn(
          { err: disconnectErr, projectId },
          "Failed to disconnect Caddy from project network",
        );
      }
    }

    const network = docker.getNetwork(networkName);
    await network.remove();
    log.info({ projectId }, "Project network removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, projectId }, "Failed to remove project network");
    return Result.err(err);
  }
}

export async function createPolicyNetwork(
  projectId: string,
  environmentId: string,
  policyName: string,
): Promise<Result<NetworkCreateResult, Error>> {
  const docker = getDockerClient();
  const networkName = policyNetworkName(projectId, environmentId, policyName);

  try {
    const networks = await docker.listNetworks({
      filters: { name: [networkName] },
    });
    const existing = networks.find((n) => n.Name === networkName);

    if (existing) {
      log.info({ networkId: existing.Id, policyName }, "Policy network already exists");
      return Result.ok({ networkId: existing.Id, alreadyExists: true });
    }

    const network = await docker.createNetwork({
      Name: networkName,
      Driver: "overlay",
      Attachable: true,
      Options: { encrypted: "true" },
      Labels: {
        "otterstack.managed": "true",
        "otterstack.project.id": projectId,
        "otterstack.environment.id": environmentId,
        "otterstack.network.role": "policy",
        "otterstack.network.policy": policyName,
      },
    });

    log.info({ networkId: network.id, policyName }, "Policy network created");

    const caddy = await findCaddyService(docker);
    if (caddy) {
      const caddyInfo = await caddy.inspect();
      try {
        await connectServiceToNetworkById(docker, caddyInfo.ID, networkName);
        log.info({ policyName }, "Caddy connected to policy network");
      } catch (connectErr) {
        log.warn({ err: connectErr, policyName }, "Failed to connect Caddy to policy network");
      }
    }

    return Result.ok({ networkId: network.id, alreadyExists: false });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, policyName }, "Failed to create policy network");
    return Result.err(err);
  }
}

export async function removePolicyNetwork(
  projectId: string,
  environmentId: string,
  policyName: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();
  const networkName = policyNetworkName(projectId, environmentId, policyName);

  try {
    const caddy = await findCaddyService(docker);
    if (caddy) {
      const caddyInfo = await caddy.inspect();
      try {
        await disconnectServiceFromNetworkById(docker, caddyInfo.ID, networkName);
      } catch (disconnectErr) {
        log.warn({ err: disconnectErr, policyName }, "Failed to disconnect Caddy from policy network");
      }
    }

    const network = docker.getNetwork(networkName);
    await network.remove();
    log.info({ policyName }, "Policy network removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, policyName }, "Failed to remove policy network");
    return Result.err(err);
  }
}

export async function connectServiceToNetwork(
  serviceName: string,
  networkName: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    const service = docker.getService(serviceName);
    const inspection = await service.inspect();
    await connectServiceToNetworkById(docker, inspection.ID, networkName);
    log.info({ serviceName, networkName }, "Service connected to network");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error(
      { err, serviceName, networkName },
      "Failed to connect service to network",
    );
    return Result.err(err);
  }
}

export async function disconnectServiceFromNetwork(
  serviceName: string,
  networkName: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    const service = docker.getService(serviceName);
    const inspection = await service.inspect();
    await disconnectServiceFromNetworkById(docker, inspection.ID, networkName);
    log.info({ serviceName, networkName }, "Service disconnected from network");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error(
      { err, serviceName, networkName },
      "Failed to disconnect service from network",
    );
    return Result.err(err);
  }
}

export { projectNetworkName, policyNetworkName };
