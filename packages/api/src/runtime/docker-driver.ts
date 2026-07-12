/**
 * Plain-Docker runtime driver — the DEFAULT, single-node backend. Runs each
 * service/database as an ordinary container on a per-project user-defined
 * BRIDGE network, with container-name DNS (exactly what Docker Compose gives
 * you — no Swarm overlay/VIP/manager required).
 *
 * Mapping vs Swarm:
 *   - service     → one `docker create` + `start` container; `update` recreates.
 *   - replicas    → always 1 (real fan-out + load-balancing needs Swarm; the UI
 *                   gates replicas>1 behind "scaling").
 *   - rolling     → recreate (brief blip). Blue-green is a later add.
 *   - DNS         → container Aliases on the project bridge network.
 *   - status      → `docker ps` State + Health (no swarm tasks).
 *
 * The lower-level container/network helpers live in `./docker-driver-helpers`.
 * See docs/designs/runtime.md.
 */

import { Docker } from "@otterdeploy/docker";

import type { DeploymentId } from "@otterdeploy/shared/id";

import type { Summary } from "./docker-driver-helpers";
import type { ContainerSpec, RuntimeDriver, RuntimeStatus } from "./types";

import { createStackDeployLog, nullStackDeployLog } from "../lib/deploy-log";
import { asStepLogger } from "../lib/logger";
import { branchDatabaseOnDocker, destroyDatabaseBranchOnDocker } from "./docker-driver-branch";
import { runDatabase } from "./docker-driver-db";
import {
  buildContainerOptions,
  createAndStart,
  ensureBridgeNetwork,
  findContainer,
  mapHealth,
  mapStatus,
  networkNameFor,
  pullImage,
  removeContainerByName,
  waitForContainer,
} from "./docker-driver-helpers";

/**
 * Pull the service image, mirroring condensed pull progress into the
 * deployment's log channel so a slow multi-minute download live-tails in the
 * web UI instead of looking like a hung deploy (container missing, no output).
 * Mirrors the database driver (docker-driver-db). Best-effort: no deployment
 * row → the null log swallows the lines and the pull still runs.
 */
async function pullWithDeployLog(docker: Docker, spec: ContainerSpec): Promise<void> {
  const deployLog = spec.deploymentId
    ? createStackDeployLog(spec.deploymentId as DeploymentId)
    : nullStackDeployLog;
  try {
    await pullImage(docker, spec.image, (line) => deployLog.line(line));
  } finally {
    await deployLog.close();
  }
}

export const dockerDriver: RuntimeDriver = {
  kind: "docker",

  async provision(spec) {
    const docker = Docker.fromEnv();
    const networkName = await ensureBridgeNetwork(docker, spec.projectSlug);
    // replicas:0 = scaled to zero (stopped) — plain Docker has no replica count,
    // so honor it by ensuring no container runs.
    if (spec.replicas === 0) {
      await removeContainerByName(docker, spec.serviceName);
      docker.destroy();
      return {
        serviceId: null,
        serviceName: spec.serviceName,
        networkName,
        status: "stopped",
        health: null,
      };
    }
    // Idempotent: if it's already there, report it (mirrors provisionSwarmService).
    const existing = await findContainer(docker, spec.serviceName);
    if (existing && existing.State === "running") {
      const status = await waitForContainer(docker, spec.serviceName, networkName);
      docker.destroy();
      return status;
    }
    await removeContainerByName(docker, spec.serviceName);
    await pullWithDeployLog(docker, spec);
    const status = await createAndStart(
      docker,
      buildContainerOptions(spec, networkName),
      spec.serviceName,
      networkName,
    );
    docker.destroy();
    return status;
  },

  async update(spec) {
    const docker = Docker.fromEnv();
    const networkName = await ensureBridgeNetwork(docker, spec.projectSlug);
    if (spec.replicas === 0) {
      await removeContainerByName(docker, spec.serviceName);
      docker.destroy();
      return {
        serviceId: null,
        serviceName: spec.serviceName,
        networkName,
        status: "stopped",
        health: null,
      };
    }
    // Recreate — plain Docker has no in-place rolling update. Stop the old
    // container, start the new one (brief blip).
    await removeContainerByName(docker, spec.serviceName);
    await pullWithDeployLog(docker, spec);
    const status = await createAndStart(
      docker,
      buildContainerOptions(spec, networkName),
      spec.serviceName,
      networkName,
    );
    docker.destroy();
    return status;
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
    const networkName = networkNameFor(input.projectSlug);
    const summary = await findContainer(docker, input.serviceName);
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
    // to its container by exact name — replaces the per-service `inspect` that
    // opened a fresh Docker connection + lookup for every item in the list.
    const list = await docker.containers.list({
      all: true,
      filters: { label: ["otterdeploy.managed=true"] },
    });
    docker.destroy();
    if (list.isErr()) throw list.error;

    const byName = new Map<string, Summary>();
    for (const container of list.value) {
      const summary = container as unknown as Summary;
      // Name filter would be a substring match; index by the exact `/name` the
      // way findContainer pins it, stripping docker's leading slash.
      for (const name of summary.Names ?? []) byName.set(name.replace(/^\//, ""), summary);
    }

    for (const input of inputs) {
      const summary = byName.get(input.serviceName) ?? null;
      result.set(input.serviceName, {
        serviceId: summary?.Id ?? null,
        serviceName: input.serviceName,
        networkName: networkNameFor(input.projectSlug),
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
    const networkName = networkNameFor(input.projectSlug);
    const summary = await findContainer(docker, input.serviceName);
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
