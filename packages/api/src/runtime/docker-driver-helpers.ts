/**
 * Lower-level helpers for the plain-Docker runtime driver (see
 * `./docker-driver.ts`): network/image setup, container lookup + lifecycle,
 * status/health mapping, the create-payload builder, and the readiness poll.
 * The database provision path lives in `./docker-driver-db.ts`. Split out so
 * `./docker-driver.ts` stays focused on the `RuntimeDriver` surface itself.
 */

import { Docker } from "@otterdeploy/docker";
import { setTimeout as sleep } from "node:timers/promises";

import type { ContainerSpec, RuntimeStatus } from "./types";

import { PLATFORM } from "../constants";
import { connectCaddyToNetwork } from "../swarm/client";

export const msToNs = (ms: number) => ms * 1_000_000;
export const networkNameFor = (projectSlug: string) =>
  `${PLATFORM.swarm.networkPrefix}${projectSlug}`;

export const otterLabels = (
  spec: { resourceId: string; projectSlug: string; deploymentId?: string | null },
  resourceType: string,
): Record<string, string> => ({
  "otterdeploy.managed": "true",
  "otterdeploy.resource.type": resourceType,
  "otterdeploy.resource.id": spec.resourceId,
  "otterdeploy.project": spec.projectSlug,
  ...(spec.deploymentId ? { "otterdeploy.deployment.id": spec.deploymentId } : {}),
});

// A container that exits on boot (e.g. a missing env var) would otherwise
// restart forever: docker's `on-failure` with MaximumRetryCount 0 means
// UNLIMITED. Bound it so a crash-loop gives up instead of hammering the host
// (mirrors the swarm driver + DB driver caps). A user-set maxAttempts still
// wins. Docker resets the count once the container stays up, so occasional
// failures still recover — only a tight loop trips the cap.
const DEFAULT_MAX_RESTART_ATTEMPTS = 5;

/** Compose-style restart policy: swarm condition → plain-docker restart name. */
function toRestartPolicy(restart: ContainerSpec["restart"]): {
  Name: "" | "no" | "always" | "unless-stopped" | "on-failure";
  MaximumRetryCount?: number;
} {
  if (restart.condition === "none") return { Name: "no" };
  if (restart.condition === "on-failure")
    return {
      Name: "on-failure",
      MaximumRetryCount: restart.maxAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS,
    };
  // "any" → keep it up across crashes, but not after an explicit operator stop.
  return { Name: "unless-stopped" };
}

/** Ensure the project's user-defined bridge network exists (idempotent). On a
 *  single-node host this replaces the swarm overlay — containers on it resolve
 *  each other by name/alias. */
export async function ensureBridgeNetwork(docker: Docker, projectSlug: string): Promise<string> {
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
export async function pullImage(docker: Docker, image: string): Promise<void> {
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

export async function findContainer(docker: Docker, name: string): Promise<Summary | null> {
  const list = await docker.containers.list({
    all: true,
    filters: { name: [name] },
  });
  if (list.isErr()) throw list.error;
  // Name filter is a substring match — pin to the exact `/name`.
  const found = list.value.find((c) => c.Names?.some((n) => n === `/${name}` || n === name));
  return (found as Summary | undefined) ?? null;
}

export async function removeContainerByName(docker: Docker, name: string): Promise<void> {
  const existing = await findContainer(docker, name);
  if (!existing) return;
  const container = docker.containers.getContainer(existing.Id);
  // Stop may legitimately fail (already exited / never started) — the forced
  // remove below is what matters.
  await container.stop({ t: 10 });
  const removed = await container.remove({ force: true, v: false });
  if (removed.isErr()) {
    // Swallowing this used to let the follow-up create run head-first into a
    // docker 409 name Conflict. Only tolerate the failure when the container
    // is genuinely gone (e.g. a concurrent removal won the race).
    const still = await findContainer(docker, name);
    if (still) throw removed.error;
  }
}

export function mapStatus(summary: Summary | null): RuntimeStatus["status"] {
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

export function mapHealth(summary: Summary | null): RuntimeStatus["health"] {
  const h = summary?.Health?.Status;
  if (h === "healthy") return "healthy";
  if (h === "unhealthy") return "unhealthy";
  if (h === "starting") return "starting";
  return null;
}

/** Poll until the container settles (running + health resolved, or errored). */
export async function waitForContainer(
  docker: Docker,
  name: string,
  networkName: string,
): Promise<RuntimeStatus> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const summary = await findContainer(docker, name);
    const status = mapStatus(summary);
    const health = mapHealth(summary);
    const settled =
      status === "error" || status === "stopped" || (status === "running" && health !== "starting");
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
export function buildContainerOptions(
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
    ...(spec.entrypoint && spec.entrypoint.length > 0 ? { Entrypoint: spec.entrypoint } : {}),
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

export async function createAndStart(
  docker: Docker,
  options: Record<string, unknown>,
  name: string,
  networkName: string,
): Promise<RuntimeStatus> {
  let created = await docker.containers.create(
    options as Parameters<Docker["containers"]["create"]>[0],
  );
  // Self-heal a name Conflict once: a leftover container from a failed prior
  // deploy (or a racing one) owns the name — remove it and retry, instead of
  // surfacing docker's "you have to remove that container" at the operator.
  if (created.isErr() && /container name .* already in use/i.test(created.error.message)) {
    await removeContainerByName(docker, name);
    created = await docker.containers.create(
      options as Parameters<Docker["containers"]["create"]>[0],
    );
  }
  if (created.isErr()) throw created.error;
  const start = await created.value.start();
  if (start.isErr()) throw start.error;
  return waitForContainer(docker, name, networkName);
}
