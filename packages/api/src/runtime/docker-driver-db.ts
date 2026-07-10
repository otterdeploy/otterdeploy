/**
 * Database provision-or-recreate path for the plain-Docker runtime driver
 * (see `./docker-driver.ts`). Stateful single-replica, so we always recreate
 * (stop-first) — no risk of two processes holding the same volume. Shares the
 * container/network helpers in `./docker-driver-helpers`.
 */

import type { DeploymentId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";

import type { DatabaseSpec, DatabaseStatus } from "./types";

import { createStackDeployLog, nullStackDeployLog } from "../lib/deploy-log";
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

  // Databases are NEVER host-published, matching the swarm driver: public
  // access is the Caddy layer4 `proxy_route` (edge listens on the engine
  // port and dials the container over the project bridge Caddy is attached
  // to). A host binding here would also collide with Caddy's own published
  // engine port. `input.public` only gates that route; the container spec is
  // identical either way — which is what makes the public toggle roll-free.
  const hostConfig: Record<string, unknown> = {
    RestartPolicy: { Name: "on-failure", MaximumRetryCount: 5 },
    Mounts: [{ Type: "volume", Source: input.volumeName, Target: adapter.mountTarget }],
  };

  const options: Record<string, unknown> = {
    name: input.serviceName,
    Image: input.image ?? adapter.defaultImage,
    Env: [...userEnv, ...identityEnv],
    ...(cmd ? { Cmd: cmd } : {}),
    Labels: labels,
    // A container's UTS hostname is set via Linux `sethostname`, which caps the
    // whole string at 64 bytes. The internal FQDN alias can exceed that for long
    // branch/resource names (a preview DB hit 72 bytes), crashing runc with
    // "sethostname: invalid argument" so the container never starts. A UTS
    // hostname is conventionally a short single label anyway — nothing resolves
    // it (in-cluster DNS uses the network aliases below, which keep the full
    // FQDN). Use the sanitized, ≤63-char service name unconditionally.
    Hostname: input.serviceName,
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
  // Mirror pull progress into the deployment's log channel — a multi-minute
  // image download otherwise looks like a hung deploy (container missing, no
  // output anywhere), and recent log lines keep the zero-task stale check
  // from flipping a slow pull to "failed".
  const deployLog = input.deploymentId
    ? createStackDeployLog(input.deploymentId as DeploymentId)
    : nullStackDeployLog;
  try {
    await pullImage(docker, options.Image as string, (line) => deployLog.line(line));
  } finally {
    await deployLog.close();
  }
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
