import { Docker } from "@otterdeploy/docker";
import * as z from "zod";

export interface SwarmJoinTokens {
  worker: string;
  manager: string;
  /** "<ip>:2377": what the operator pastes after the token in
   *  `docker swarm join --token … <managerAddr>`. */
  managerAddr: string;
}

const UNKNOWN = "–";
const SWARM_PORT = 2377;

/** The slice of `docker swarm inspect` we read. The endpoint returns
 *  `unknown`, so parse instead of casting; a shape mismatch degrades to
 *  the same UNKNOWN placeholders a missing field does. */
const swarmInspectSchema = z.object({
  JoinTokens: z.object({ Worker: z.string().nullish(), Manager: z.string().nullish() }).nullish(),
});

/** The Swarm block of `docker info` (typed as a bag of unknowns upstream).
 *  Fields are nullish: a non-manager daemon reports NodeAddr "" and
 *  RemoteManagers null. */
const infoSwarmSchema = z.object({
  NodeAddr: z.string().nullish(),
  RemoteManagers: z.array(z.object({ Addr: z.string().nullish() })).nullish(),
});

/** Manager address: prefer NodeAddr from `docker info` (this is the
 *  advertise address this manager is using). Fallback to the first
 *  RemoteManager's Addr if NodeAddr isn't reported. */
function resolveManagerAddr(swarmBlock: unknown): string {
  const parsed = infoSwarmSchema.safeParse(swarmBlock);
  const swarmInfo = parsed.success ? parsed.data : null;
  const nodeAddr = swarmInfo?.NodeAddr;
  if (nodeAddr) {
    // NodeAddr is bare IP. Swarm port is the well-known 2377.
    return nodeAddr.includes(":") ? nodeAddr : `${nodeAddr}:${SWARM_PORT}`;
  }
  const remote = swarmInfo?.RemoteManagers?.[0]?.Addr;
  return remote ? remote : UNKNOWN;
}

/**
 * Internal control-plane primitive. Never expose this result through a router,
 * UI, log, or durable record; callers must constrain its lifetime to a single
 * provisioning or one-time enrollment operation.
 */
export async function getSwarmJoinTokens(): Promise<SwarmJoinTokens> {
  const docker = Docker.fromEnv();
  try {
    const swarm = await docker.system.swarmInspect();
    if (swarm.isErr()) {
      return { worker: UNKNOWN, manager: UNKNOWN, managerAddr: UNKNOWN };
    }
    const inspect = swarmInspectSchema.safeParse(swarm.value);
    const joinTokens = inspect.success ? inspect.data.JoinTokens : null;

    const info = await docker.system.info();
    const managerAddr = info.isOk() ? resolveManagerAddr(info.value.Swarm) : UNKNOWN;

    return {
      worker: joinTokens?.Worker ?? UNKNOWN,
      manager: joinTokens?.Manager ?? UNKNOWN,
      managerAddr,
    };
  } finally {
    docker.destroy();
  }
}
