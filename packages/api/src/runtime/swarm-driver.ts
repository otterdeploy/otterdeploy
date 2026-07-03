import { createError } from "evlog";

import type { RuntimeDriver } from "./types";

import {
  destroySwarmDatabase,
  inspectSwarmDatabaseRuntime,
  provisionSwarmDatabase,
  updateSwarmDatabase,
} from "../swarm/database";
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

  // COW DB branching is not wired on swarm yet. Plain Docker is the default
  // runtime and carries P2's copy path; the swarm integration (provision a
  // branch service + copy over the overlay) lands with P3. Fail loudly rather
  // than silently no-op so a preview never appears to branch when it didn't.
  async branchDatabase() {
    throw createError({
      message: "database branching is not implemented on the swarm runtime yet",
      status: 501,
      why: "P2 ships the copy branch path on the plain-Docker driver only; swarm branching lands in P3",
    });
  },
  async destroyDatabaseBranch() {
    throw createError({
      message: "database branch teardown is not implemented on the swarm runtime yet",
      status: 501,
      why: "P2 ships branching on the plain-Docker driver only; swarm branching lands in P3",
    });
  },
};
