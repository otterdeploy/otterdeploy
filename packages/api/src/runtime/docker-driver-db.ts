/**
 * Database provision-or-recreate path for the plain-Docker runtime driver
 * (see `./docker-driver.ts`). Stateful single-replica, so we always recreate
 * (stop-first) — no risk of two processes holding the same volume. Shares the
 * container/network helpers in `./docker-driver-helpers`.
 */

import { Docker } from "@otterdeploy/docker";

import type { DatabaseSpec, DatabaseStatus } from "./types";

import { getEngineAdapter } from "../swarm/database-engines";
import {
  createAndStart,
  ensureBridgeNetwork,
  msToNs,
  otterLabels,
  pullImage,
  removeContainerByName,
} from "./docker-driver-helpers";

export async function runDatabase(input: DatabaseSpec): Promise<DatabaseStatus> {
  const docker = Docker.fromEnv();
  const adapter = getEngineAdapter(input.engine);
  const networkName = await ensureBridgeNetwork(docker, input.projectSlug);

  const userEnv = Object.entries(input.extraEnv ?? {})
    .filter(([k]) => !adapter.reservedEnvKeys.has(k))
    .map(([k, v]) => `${k}=${v}`);
  const identityEnv = adapter.buildEnv({
    username: input.username,
    password: input.password,
    databaseName: input.databaseName,
  });
  // buildCommand belongs in CMD (the image's entrypoint script runs it) — the
  // plain-docker-correct slot, unlike swarm's ContainerSpec.Command.
  const cmd = adapter.buildCommand?.({ password: input.password });
  const labels = otterLabels(
    {
      resourceId: input.resourceId,
      projectSlug: input.projectSlug,
      deploymentId: input.deploymentId,
    },
    input.engine,
  );

  const hostConfig: Record<string, unknown> = {
    RestartPolicy: { Name: "on-failure", MaximumRetryCount: 5 },
    Mounts: [{ Type: "volume", Source: input.volumeName, Target: adapter.mountTarget }],
  };
  if (input.public) {
    hostConfig.PortBindings = {
      [`${adapter.port}/tcp`]: [{ HostPort: String(adapter.port) }],
    };
  }

  const options: Record<string, unknown> = {
    name: input.serviceName,
    Image: input.image ?? adapter.defaultImage,
    Env: [...userEnv, ...identityEnv],
    ...(cmd ? { Cmd: cmd } : {}),
    Labels: labels,
    Hostname: input.hostnameAlias,
    Healthcheck: {
      Test: [
        "CMD-SHELL",
        adapter.buildHealthcheck({
          username: input.username,
          password: input.password,
          databaseName: input.databaseName,
        }),
      ],
      Interval: msToNs(5000),
      Timeout: msToNs(3000),
      Retries: 20,
    },
    HostConfig: hostConfig,
    NetworkingConfig: {
      EndpointsConfig: {
        [networkName]: { Aliases: [input.serviceName, input.hostnameAlias] },
      },
    },
  };

  await removeContainerByName(docker, input.serviceName);
  await pullImage(docker, options.Image as string);
  const status = await createAndStart(docker, options, input.serviceName, networkName);
  docker.destroy();
  return {
    serviceId: status.serviceId,
    serviceName: input.serviceName,
    volumeName: input.volumeName,
    networkName,
    status: status.status,
    health: status.health,
    wasCreated: true,
  };
}
