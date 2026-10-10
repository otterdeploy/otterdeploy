/**
 * Plain-Docker runtime driver: the DEFAULT, single-node backend. Runs each
 * service/database as an ordinary container on a per-project user-defined
 * BRIDGE network, with container-name DNS (exactly what Docker Compose gives
 * you, no Swarm overlay/VIP/manager required).
 *
 * Mapping vs Swarm:
 *   - service     → one `docker create` + `start` container; `update` recreates.
 *   - replicas    → always 1 (real fan-out + load-balancing needs Swarm; the UI
 *                   gates replicas>1 behind "scaling").
 *   - rolling     → health-gated blue-green (docker-rollout.ts): the new
 *                   container must pass the readiness gate before it takes
 *                   the service's aliases; a failed one is removed and the
 *                   previous version keeps serving.
 *   - DNS         → container Aliases on the project bridge network.
 *   - status      → `docker ps` State + Health (no swarm tasks).
 *
 * The lower-level container/network helpers live in `./docker-driver-helpers`.
 * See docs/designs/runtime.md.
 */

import type { RequestLogger } from "evlog";

import { Docker } from "@otterdeploy/docker";
import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";

import type { Summary } from "./docker-driver-helpers";
import type { ContainerSpec, RuntimeDriver, RuntimeStatus } from "./types";

import { createStackDeployLog, nullStackDeployLog } from "../lib/deploy-log";
import { asStepLogger } from "../lib/logger";
import { branchDatabaseOnDocker, destroyDatabaseBranchOnDocker } from "./docker-driver-branch";
import { runDatabase } from "./docker-driver-db";
import {
  buildContainerOptions,
  ensureBridgeNetwork,
  findContainer,
  mapHealth,
  mapStatus,
  networkNameFor,
  pullImage,
  removeContainerByName,
  serviceAliases,
  waitForContainer,
} from "./docker-driver-helpers";
import { moveToScopedNetwork } from "./docker-network-migration";
import { rollOutContainer } from "./docker-rollout";
import { createDockerRolloutHost } from "./docker-rollout-host";
import { exclusiveRollout } from "./exclusive-rollout";
import { readinessPlan, readinessPort } from "./readiness";

function deployLogFor(spec: ContainerSpec, phase: "build" | "deploy") {
  // `ContainerSpec.deploymentId` is a plain string; recover the brand with a
  // real prefix check instead of a cast (mirrors docker-driver-db).
  return spec.deploymentId && hasPrefix(spec.deploymentId, ID_PREFIX.deployment)
    ? createStackDeployLog(spec.deploymentId, phase)
    : nullStackDeployLog;
}

/**
 * Pull the service image, mirroring condensed pull progress into the
 * deployment's log channel so a slow multi-minute download live-tails in the
 * web UI instead of looking like a hung deploy (container missing, no output).
 * Mirrors the database driver (docker-driver-db). Best-effort: no deployment
 * row → the null log swallows the lines and the pull still runs.
 */
async function pullWithDeployLog(docker: Docker, spec: ContainerSpec): Promise<void> {
  const deployLog = deployLogFor(spec, "build");
  try {
    await pullImage(docker, spec.image, (line) => deployLog.line(line), spec.registryAuth);
  } finally {
    await deployLog.close();
  }
}

/** Remove the service's container: replicas 0 means scaled to zero. */
async function scaleToZero(docker: Docker, spec: ContainerSpec, networkName: string) {
  await removeContainerByName(docker, spec.serviceName);
  return {
    serviceId: null,
    serviceName: spec.serviceName,
    networkName,
    status: "stopped" as const,
    health: null,
  };
}

/**
 * Pull, then roll the new version out behind the readiness gate
 * (docker-rollout.ts): the previous version keeps serving until the new one is
 * ready, and stays when it never gets there.
 */
async function rollOut(
  docker: Docker,
  spec: ContainerSpec,
  networkName: string,
  log?: RequestLogger,
): Promise<RuntimeStatus> {
  await pullWithDeployLog(docker, spec);
  const deployLog = deployLogFor(spec, "deploy");
  try {
    const host = createDockerRolloutHost(docker, {
      networkName,
      extraNetworks: spec.extraNetworks ?? [],
      deployLog,
      log,
    });
    return await rollOutContainer(host, {
      options: buildContainerOptions(spec, networkName),
      serviceName: spec.serviceName,
      networkName,
      aliases: serviceAliases(spec),
      plan: readinessPlan({
        healthcheck: spec.healthcheck ?? null,
        port: readinessPort(spec.ports),
      }),
      exclusive: exclusiveRollout(spec),
    });
  } finally {
    await deployLog.close();
  }
}

export const dockerDriver: RuntimeDriver = {
  kind: "docker",

  async provision(spec, log) {
    const docker = Docker.fromEnv();
    try {
      const networkName = await ensureBridgeNetwork(
        docker,
        spec.projectSlug,
        spec.networkScopeSuffix,
      );
      // replicas:0 = scaled to zero (stopped). Plain Docker has no replica
      // count, so honor it by ensuring no container runs.
      if (spec.replicas === 0) return await scaleToZero(docker, spec, networkName);
      // Idempotent: if it's already there, report it (mirrors provisionSwarmService).
      const existing = await findContainer(docker, spec.serviceName);
      if (existing && existing.State === "running") {
        await moveToScopedNetwork(
          docker,
          existing.Id,
          spec.projectSlug,
          networkName,
          serviceAliases(spec),
        );
        return await waitForContainer(docker, spec.serviceName, networkName);
      }
      return await rollOut(docker, spec, networkName, log);
    } finally {
      docker.destroy();
    }
  },

  async update(spec, log) {
    const docker = Docker.fromEnv();
    try {
      const networkName = await ensureBridgeNetwork(
        docker,
        spec.projectSlug,
        spec.networkScopeSuffix,
      );
      if (spec.replicas === 0) return await scaleToZero(docker, spec, networkName);
      return await rollOut(docker, spec, networkName, log);
    } finally {
      docker.destroy();
    }
  },

  async destroy(input, rlog) {
    const log = asStepLogger(rlog);
    const docker = Docker.fromEnv();
    log.info({ runtime: { step: "remove-container", service: input.serviceName } });
    await removeContainerByName(docker, input.serviceName);
    docker.destroy();
  },

  async inspect(input) {
    const docker = Docker.fromEnv();
    const summary = await findContainer(docker, input.serviceName);
    const networkName = inspectedNetworkName(summary, input);
    docker.destroy();
    return {
      serviceId: summary?.Id ?? null,
      serviceName: input.serviceName,
      networkName,
      status: mapStatus(summary),
      health: mapHealth(summary),
    };
  },

  async inspectMany(inputs) {
    const result = new Map<string, RuntimeStatus>();
    if (inputs.length === 0) return result;
    const docker = Docker.fromEnv();
    // ONE list over all managed containers, then match each requested service
    // to its container by exact name: replaces the per-service `inspect` that
    // opened a fresh Docker connection + lookup for every item in the list.
    const list = await docker.containers.list({
      all: true,
      filters: { label: ["otterdeploy.managed=true"] },
    });
    docker.destroy();
    if (list.isErr()) throw list.error;

    const byName = new Map<string, Summary>();
    for (const container of list.value) {
      const summary: Summary = container;
      // Name filter would be a substring match; index by the exact `/name` the
      // way findContainer pins it, stripping docker's leading slash.
      for (const name of summary.Names) byName.set(name.replace(/^\//, ""), summary);
    }

    for (const input of inputs) {
      const summary = byName.get(input.serviceName) ?? null;
      result.set(input.serviceName, {
        serviceId: summary?.Id ?? null,
        serviceName: input.serviceName,
        networkName: inspectedNetworkName(summary, input),
        status: mapStatus(summary),
        health: mapHealth(summary),
      });
    }
    return result;
  },

  // ── Databases ──────────────────────────────────────────────────────────
  async provisionDatabase(input) {
    return runDatabase(input);
  },
  async updateDatabase(input) {
    return runDatabase(input);
  },
  async destroyDatabase(input, rlog) {
    const log = asStepLogger(rlog);
    const docker = Docker.fromEnv();
    log.info({ runtime: { step: "remove-db-container", service: input.serviceName } });
    await removeContainerByName(docker, input.serviceName);
    docker.destroy();
  },

  // ── Database branching (copy-on-write) ───────────────────────────────────
  async branchDatabase(input, rlog) {
    return branchDatabaseOnDocker(input, rlog);
  },
  async destroyDatabaseBranch(input, rlog) {
    return destroyDatabaseBranchOnDocker(input, rlog);
  },

  async inspectDatabase(input) {
    const docker = Docker.fromEnv();
    const summary = await findContainer(docker, input.serviceName);
    const networkName = inspectedNetworkName(summary, input);
    docker.destroy();
    return {
      serviceId: summary?.Id ?? null,
      serviceName: input.serviceName,
      volumeName: input.volumeName,
      networkName,
      status: mapStatus(summary),
      health: mapHealth(summary),
    };
  },
};

function inspectedNetworkName(
  summary: Summary | null,
  input: { projectSlug: string; networkScopeSuffix?: string },
): string {
  const expected = networkNameFor(input.projectSlug, input.networkScopeSuffix);
  const networks = Object.keys(summary?.NetworkSettings?.Networks ?? {});
  return (
    networks.find((name) => name === expected) ??
    networks.find((name) => name.startsWith(`${networkNameFor(input.projectSlug)}.`)) ??
    expected
  );
}
