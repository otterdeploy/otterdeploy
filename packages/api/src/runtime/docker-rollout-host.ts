/**
 * The real {@link RolloutHost}: the plain-Docker daemon behind the health-gated
 * cutover in docker-rollout.ts.
 *
 * The port probe runs from the edge's side of the network (edge-probe.ts).
 * When the edge cannot run it, the container's own listening sockets
 * (`/proc/net/tcp`) answer instead; when neither can be read the port gate is
 * skipped, never failed.
 */
import type { CreateContainerOptions } from "@otterdeploy/docker";
import type { Docker } from "@otterdeploy/docker";
import type { RequestLogger } from "evlog";

import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { createError } from "evlog";
import { setTimeout as sleep } from "node:timers/promises";

import type { StackDeployLog } from "../lib/deploy-log";
import type { ContainerObservation, RolloutHost } from "./docker-rollout";
import type { Listener } from "./readiness";

import { demuxDockerStream } from "../swarm/stream-parse";
import { findContainer, removeContainerByName, startContainer } from "./docker-driver-helpers";
import { probeEdgePort, readContainerListeners } from "./edge-probe";
import { listenerProbe } from "./readiness";

/** Seconds a parked version gets to finish in-flight requests when stopped. */
const STOP_GRACE_S = 10;

function missing(name: string, step: string) {
  return createError({
    message: `container ${name} disappeared during the rollout`,
    status: 500,
    why: `the ${step} step of the health-gated cutover found no container named ${name}`,
  });
}

function healthOf(status: string | undefined): ContainerObservation["health"] {
  if (status === "healthy" || status === "unhealthy" || status === "starting") return status;
  return null;
}

export function createDockerRolloutHost(
  docker: Docker,
  context: {
    networkName: string;
    extraNetworks: string[];
    deployLog: StackDeployLog;
    log?: RequestLogger;
  },
): RolloutHost {
  async function readListeners(name: string): Promise<Listener[] | null> {
    const found = await findContainer(docker, name);
    return found ? readContainerListeners(docker, found.Id) : null;
  }

  return {
    async observe(name) {
      const found = await findContainer(docker, name);
      if (!found) return null;
      const inspected = await docker.containers.inspect(found.Id);
      if (inspected.isErr()) return null;
      const { State: state, RestartCount: restartCount } = inspected.value;
      const healthLog = state.Health?.Log ?? [];
      return {
        id: inspected.value.Id,
        state: state.Status,
        // Running again after a restart, docker reports exit 0: only a stopped
        // or restarting container carries the code it died with.
        exitCode: state.Status === "running" ? null : state.ExitCode,
        restartCount,
        oomKilled: state.OOMKilled,
        health: healthOf(state.Health?.Status),
        healthOutput: healthLog.at(-1)?.Output ?? null,
      };
    },

    async probePort(name, port) {
      const viaEdge = await probeEdgePort(docker, name, port);
      if (viaEdge !== "unavailable") return viaEdge;
      const listeners = await readListeners(name);
      return listeners ? listenerProbe(listeners, port) : "unavailable";
    },

    listeners: readListeners,

    async logTail(name, lines) {
      const found = await findContainer(docker, name);
      if (!found) return [];
      const logs = await docker.containers
        .getContainer(found.Id)
        .logs({ follow: false, stdout: true, stderr: true, tail: String(lines) });
      if (logs.isErr()) return [];
      const out: string[] = [];
      const read = await Result.tryPromise({
        try: async () => {
          for await (const chunk of demuxDockerStream(logs.value)) out.push(chunk.line);
        },
        catch: (cause) => cause,
      });
      return read.isOk() ? out.slice(-lines) : out;
    },

    async createAndStart(options: CreateContainerOptions) {
      const name = options.name ?? "";
      await startContainer(
        docker,
        options,
        name,
        context.networkName,
        context.extraNetworks,
        context.log,
      );
    },

    // Graceful: removeContainerByName stops with a 10 s grace before removing,
    // so the old version finishes its in-flight requests on cutover.
    remove: (name) => removeContainerByName(docker, name),

    async stop(name) {
      const found = await findContainer(docker, name);
      if (!found) return;
      // Already stopped is fine: the rename/remove that follows is what counts.
      await docker.containers.getContainer(found.Id).stop({ t: STOP_GRACE_S });
    },

    async start(name) {
      const found = await findContainer(docker, name);
      if (!found) throw missing(name, "start");
      const started = await docker.containers.getContainer(found.Id).start();
      if (started.isErr()) throw started.error;
    },

    async rename(from, to) {
      const found = await findContainer(docker, from);
      if (!found) throw missing(from, "rename");
      const renamed = await docker.containers.getContainer(found.Id).rename(to);
      if (renamed.isErr()) throw renamed.error;
    },

    async setAliases(name, network, aliases) {
      const net = docker.networks.getNetwork(network);
      const off = await net.disconnect({ Container: name });
      if (off.isErr()) throw off.error;
      const on = await net.connect({ Container: name, EndpointConfig: { Aliases: aliases } });
      if (on.isErr()) throw on.error;
    },

    log: (line) => context.deployLog.line(line),
    now: () => Temporal.Now.instant().epochMilliseconds,
    sleep: async (ms) => {
      await sleep(ms);
    },
  };
}
