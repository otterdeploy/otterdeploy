import type { RuntimeDriver } from "./types";

/**
 * Runtime selector. The whole platform deploys through `runtime()` so a single
 * `DEPLOY_RUNTIME` switch (default `docker`) decides the backend — plain Docker
 * for single-node, Swarm only when an operator opts into scaling.
 * See docs/designs/runtime.md.
 */
import { dockerDriver } from "./docker-driver";
import { swarmDriver } from "./swarm-driver";

// Read the mode straight off process.env (not the validated `@otterdeploy/env`
// object) so importing the runtime — which the whole deploy path does — never
// drags full env validation into the import graph. `swarm` is opt-in; anything
// else (incl. unset) is the plain-Docker default. The env package still
// documents/validates DEPLOY_RUNTIME for the server's own startup.
function mode(): "docker" | "swarm" {
  // oxlint-disable-next-line node/no-process-env -- intentional raw read (see note above): importing @otterdeploy/env here would pull full env validation into the deploy import graph.
  return process.env.DEPLOY_RUNTIME === "swarm" ? "swarm" : "docker";
}

/** The active runtime driver for this process. */
export function runtime(): RuntimeDriver {
  return mode() === "swarm" ? swarmDriver : dockerDriver;
}

/** True when running on Swarm (scale mode) — used to gate replicas>1 etc. */
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
