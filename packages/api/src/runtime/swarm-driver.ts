/**
 * Swarm runtime driver — the opt-in, scale-across-nodes backend. Pure delegation
 * to the existing `swarm/*` functions; this is the path you get when
 * `DEPLOY_RUNTIME=swarm`. See docs/designs/runtime.md.
 */
import {
  destroySwarmService,
  inspectSwarmServiceRuntime,
  provisionSwarmService,
  updateSwarmService,
} from "../swarm/service";
import {
  destroySwarmDatabase,
  inspectSwarmDatabaseRuntime,
  provisionSwarmDatabase,
  updateSwarmDatabase,
} from "../swarm/database";
import type { RuntimeDriver } from "./types";

export const swarmDriver: RuntimeDriver = {
  kind: "swarm",
  provision: provisionSwarmService,
  update: updateSwarmService,
  destroy: destroySwarmService,
  inspect: inspectSwarmServiceRuntime,
  provisionDatabase: provisionSwarmDatabase,
  updateDatabase: updateSwarmDatabase,
  destroyDatabase: destroySwarmDatabase,
  inspectDatabase: inspectSwarmDatabaseRuntime,
};
