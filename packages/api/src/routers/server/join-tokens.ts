/**
 * Live swarm join tokens + manager address surfaced on the "Add server" /
 * "Join token" flows. Tokens rotate via `docker swarm join-token --rotate`
 * so the source of truth is always the daemon — no caching here.
 *
 * Degraded state: if the daemon isn't a swarm (or is unreachable), return
 * "—" sentinels and let the UI show the operator they need to run
 * `docker swarm init` first.
 */

import { Docker } from "@otterdeploy/docker";

export interface SwarmJoinTokens {
  worker: string;
  manager: string;
  /** "<ip>:2377" — what the operator pastes after the token in
   *  `docker swarm join --token … <managerAddr>`. */
  managerAddr: string;
}

const UNKNOWN = "—";
const SWARM_PORT = 2377;

interface SwarmInspect {
  JoinTokens?: { Worker?: string; Manager?: string };
}

interface DockerInfo {
  Swarm?: {
    NodeAddr?: string;
    RemoteManagers?: Array<{ NodeID?: string; Addr?: string }>;
  };
}

export async function getSwarmJoinTokens(): Promise<SwarmJoinTokens> {
  const docker = Docker.fromEnv();

  const swarm = await docker.system.swarmInspect();
  if (swarm.isErr()) {
    return { worker: UNKNOWN, manager: UNKNOWN, managerAddr: UNKNOWN };
  }
  const inspect = swarm.value as SwarmInspect;

  // Manager address: prefer NodeAddr from `docker info` (this is the
  // advertise address this manager is using). Fallback to the first
  // RemoteManager's Addr if NodeAddr isn't reported.
  const info = await docker.system.info();
  let managerAddr = UNKNOWN;
  if (info.isOk()) {
    const swarmInfo = (info.value as DockerInfo).Swarm;
    const nodeAddr = swarmInfo?.NodeAddr;
    if (nodeAddr) {
      // NodeAddr is bare IP — swarm port is the well-known 2377.
      managerAddr = nodeAddr.includes(":") ? nodeAddr : `${nodeAddr}:${SWARM_PORT}`;
    } else {
      const remote = swarmInfo?.RemoteManagers?.[0]?.Addr;
      if (remote) managerAddr = remote;
    }
  }

  return {
    worker: inspect.JoinTokens?.Worker ?? UNKNOWN,
    manager: inspect.JoinTokens?.Manager ?? UNKNOWN,
    managerAddr,
  };
}
