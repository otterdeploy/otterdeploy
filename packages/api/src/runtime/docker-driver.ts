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
 * See docs/designs/runtime.md.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { Docker } from "@otterdeploy/docker";

import { PLATFORM } from "../constants";
import { asStepLogger } from "../lib/logger";
import { connectCaddyToNetwork } from "../swarm/client";
import { getEngineAdapter } from "../swarm/database-engines";
import type {
  ContainerSpec,
  DatabaseSpec,
  DatabaseStatus,
  RuntimeDriver,
  RuntimeStatus,
} from "./types";

const msToNs = (ms: number) => ms * 1_000_000;
const networkNameFor = (projectSlug: string) =>
  `${PLATFORM.swarm.networkPrefix}${projectSlug}`;

const otterLabels = (
  spec: { resourceId: string; projectSlug: string; deploymentId?: string | null },
  resourceType: string,
): Record<string, string> => ({
  "otterdeploy.managed": "true",
  "otterdeploy.resource.type": resourceType,
  "otterdeploy.resource.id": spec.resourceId,
  "otterdeploy.project": spec.projectSlug,
  ...(spec.deploymentId ? { "otterdeploy.deployment.id": spec.deploymentId } : {}),
});

/** Compose-style restart policy: swarm condition → plain-docker restart name. */
function toRestartPolicy(restart: ContainerSpec["restart"]): {
  Name: "" | "no" | "always" | "unless-stopped" | "on-failure";
  MaximumRetryCount?: number;
} {
  if (restart.condition === "none") return { Name: "no" };
  if (restart.condition === "on-failure")
    return { Name: "on-failure", MaximumRetryCount: restart.maxAttempts ?? 0 };
  // "any" → keep it up across crashes, but not after an explicit operator stop.
  return { Name: "unless-stopped" };
}

/** Ensure the project's user-defined bridge network exists (idempotent). On a
 *  single-node host this replaces the swarm overlay — containers on it resolve
 *  each other by name/alias. */
async function ensureBridgeNetwork(
  docker: Docker,
  projectSlug: string,
): Promise<string> {
  const name = networkNameFor(projectSlug);
  const list = await docker.networks.list({ filters: { name: [name] } });
  if (!(list.isOk() && list.value.some((n) => n.Name === name))) {
    const created = await docker.networks.create({
      Name: name,
      Driver: "bridge",
      Attachable: true,
      Labels: { "otterdeploy.managed": "true", "otterdeploy.project": projectSlug },
    });
    // A racing create can 409 if another deploy just made it — only re-throw if
    // it's genuinely still missing after the race.
    if (created.isErr()) {
      const recheck = await docker.networks.list({ filters: { name: [name] } });
      if (!(recheck.isOk() && recheck.value.some((n) => n.Name === name))) {
        throw created.error;
      }
    }
  }
  // Attach the edge so exposed services are reachable by container name — the
  // plain-Docker equivalent of the overlay path's caddy-connect.
  await connectCaddyToNetwork(docker, name);
  return name;
}

/** Best-effort image pull — drains the progress stream to completion. A failure
 *  is non-fatal here (the image may already be local); container create will
 *  surface a real "no such image" if it's genuinely missing. */
async function pullImage(docker: Docker, image: string): Promise<void> {
  const pull = await docker.pull(image);
  if (pull.isErr()) return;
  await new Promise<void>((resolve) => {
    pull.value.on("data", () => {});
    pull.value.on("end", () => resolve());
    pull.value.on("error", () => resolve());
    pull.value.on("close", () => resolve());
  });
}

interface Summary {
  Names: string[];
  State: string;
  Id: string;
  Health?: { Status?: string };
}

async function findContainer(
  docker: Docker,
  name: string,
): Promise<Summary | null> {
  const list = await docker.containers.list({
    all: true,
    filters: { name: [name] },
  });
  if (list.isErr()) throw list.error;
  // Name filter is a substring match — pin to the exact `/name`.
  const found = list.value.find((c) =>
    c.Names?.some((n) => n === `/${name}` || n === name),
  );
  return (found as Summary | undefined) ?? null;
}

async function removeContainerByName(
  docker: Docker,
  name: string,
): Promise<void> {
  const existing = await findContainer(docker, name);
  if (!existing) return;
  const container = docker.containers.getContainer(existing.Id);
  await container.stop({ t: 10 });
  await container.remove({ force: true, v: false });
}

function mapStatus(summary: Summary | null): RuntimeStatus["status"] {
  if (!summary) return "missing";
  switch (summary.State) {
    case "running":
      return "running";
    case "created":
    case "restarting":
      return "starting";
    case "paused":
    case "exited":
      return "stopped";
    case "dead":
      return "error";
    default:
      return "missing";
  }
}

function mapHealth(summary: Summary | null): RuntimeStatus["health"] {
  const h = summary?.Health?.Status;
  if (h === "healthy") return "healthy";
  if (h === "unhealthy") return "unhealthy";
  if (h === "starting") return "starting";
  return null;
}

/** Poll until the container settles (running + health resolved, or errored). */
async function waitForContainer(
  docker: Docker,
  name: string,
  networkName: string,
): Promise<RuntimeStatus> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const summary = await findContainer(docker, name);
    const status = mapStatus(summary);
    const health = mapHealth(summary);
    const settled =
      status === "error" ||
      status === "stopped" ||
      (status === "running" && health !== "starting");
    if (settled) {
      return {
        serviceId: summary?.Id ?? null,
        serviceName: name,
        networkName,
        status,
        health,
      };
    }
    await sleep(1000);
  }
  const summary = await findContainer(docker, name);
  return {
    serviceId: summary?.Id ?? null,
    serviceName: name,
    networkName,
    status: mapStatus(summary),
    health: mapHealth(summary),
  };
}

/** Build the `docker create` payload for a service container. */
function buildContainerOptions(
  spec: ContainerSpec,
  networkName: string,
): Record<string, unknown> {
  const env = Object.entries(spec.env).map(([k, v]) => `${k}=${v}`);
  const labels = otterLabels(spec, "service");

  const exposed: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, { HostPort: string }[]> = {};
  for (const p of spec.ports) {
    const key = `${p.containerPort}/${p.protocol}`;
    exposed[key] = {};
    // tcp app-protocol ports are published on the host (mirrors swarm ingress);
    // http ports stay internal — Caddy reaches them by container name.
    if (p.appProtocol === "tcp") {
      portBindings[key] = [{ HostPort: String(p.containerPort) }];
    }
  }

  const hostConfig: Record<string, unknown> = {
    RestartPolicy: toRestartPolicy(spec.restart),
  };
  if (spec.resources?.memoryLimitMb != null)
    hostConfig.Memory = spec.resources.memoryLimitMb * 1024 * 1024;
  if (spec.resources?.cpuLimit != null)
    hostConfig.NanoCpus = Math.round(spec.resources.cpuLimit * 1e9);
  if (spec.mounts.length > 0) hostConfig.Mounts = spec.mounts;
  if (Object.keys(portBindings).length > 0) hostConfig.PortBindings = portBindings;

  return {
    name: spec.serviceName,
    Image: spec.image,
    Env: env,
    ...(spec.entrypoint && spec.entrypoint.length > 0
      ? { Entrypoint: spec.entrypoint }
      : {}),
    ...(spec.command && spec.command.length > 0 ? { Cmd: spec.command } : {}),
    Labels: labels,
    Hostname: spec.internalHostname,
    ...(spec.healthcheck
      ? {
          Healthcheck: {
            Test: ["CMD", ...spec.healthcheck.cmd],
            Interval: msToNs(spec.healthcheck.intervalMs),
            Timeout: msToNs(spec.healthcheck.timeoutMs),
            Retries: spec.healthcheck.retries,
            StartPeriod: msToNs(spec.healthcheck.startPeriodMs),
          },
        }
      : {}),
    ExposedPorts: exposed,
    HostConfig: hostConfig,
    NetworkingConfig: {
      EndpointsConfig: {
        [networkName]: {
          Aliases: [spec.serviceName, spec.internalHostname, spec.resourceName],
        },
      },
    },
  };
}

async function createAndStart(
  docker: Docker,
  options: Record<string, unknown>,
  name: string,
  networkName: string,
): Promise<RuntimeStatus> {
  const created = await docker.containers.create(
    options as Parameters<Docker["containers"]["create"]>[0],
  );
  if (created.isErr()) throw created.error;
  const start = await created.value.start();
  if (start.isErr()) throw start.error;
  return waitForContainer(docker, name, networkName);
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
      return { serviceId: null, serviceName: spec.serviceName, networkName, status: "stopped", health: null };
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
      return { serviceId: null, serviceName: spec.serviceName, networkName, status: "stopped", health: null };
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

/** Provision-or-recreate a database container. Stateful single-replica, so we
 *  always recreate (stop-first) — no risk of two processes holding the volume. */
async function runDatabase(input: DatabaseSpec): Promise<DatabaseStatus> {
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
    { resourceId: input.resourceId, projectSlug: input.projectSlug, deploymentId: input.deploymentId },
    input.engine,
  );

  const hostConfig: Record<string, unknown> = {
    RestartPolicy: { Name: "on-failure", MaximumRetryCount: 5 },
    Mounts: [
      { Type: "volume", Source: input.volumeName, Target: adapter.mountTarget },
    ],
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
  const status = await createAndStart(
    docker,
    options,
    input.serviceName,
    networkName,
  );
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
