import type { RuntimeDriver } from "./types";

/**
 * Runtime selector. The whole platform deploys through `runtime()` so a single
 * `DEPLOY_RUNTIME` switch (default `docker`) decides the backend: plain Docker
 * for single-node, Swarm only when an operator opts into scaling, and otterd
 * on installs that run it from the start (the otterd control plane schedules).
 * See docs/designs/runtime.md.
 */
import { dockerDriver } from "./docker-driver";
import { otterdDriver } from "./otterd-driver";
import { ownerAware } from "./owner-router";
import { swarmDriver } from "./swarm-driver";

// Read the mode straight off process.env (not the validated `@otterdeploy/env`
// object) so importing the runtime (which the whole deploy path does) never
// drags full env validation into the import graph. `swarm` is opt-in; anything
// else (incl. unset) is the plain-Docker default. The env package still
// documents/validates DEPLOY_RUNTIME for the server's own startup.
function mode(): "docker" | "swarm" | "otterd" {
  // oxlint-disable-next-line node/no-process-env -- intentional raw read (see note above): importing @otterdeploy/env here would pull full env validation into the deploy import graph.
  const raw = process.env.DEPLOY_RUNTIME;
  return raw === "swarm" || raw === "otterd" ? raw : "docker";
}

/** Plain Docker, with each resource routed by its owner while the install moves onto otterd. */
const dockerInstall = ownerAware(dockerDriver);

/** The active runtime driver for this process. */
export function runtime(): RuntimeDriver {
  const m = mode();
  return m === "swarm" ? swarmDriver : m === "otterd" ? otterdDriver : dockerInstall;
}

/** True when running on Swarm (scale mode), used to gate replicas>1 etc. */
export function isSwarmRuntime(): boolean {
  return mode() === "swarm";
}

export type {
  ContainerSpec,
  DatabaseSpec,
  DatabaseStatus,
  RuntimeDriver,
  RuntimeKind,
  RuntimeStatus,
} from "./types";
