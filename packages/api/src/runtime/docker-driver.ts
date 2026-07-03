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

import type { RuntimeDriver } from "./types";

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
    await pullImage(docker, spec.image);
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
    await pullImage(docker, spec.image);
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
