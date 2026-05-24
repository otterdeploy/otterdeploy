import {
  destroySwarmPostgres,
  inspectSwarmPostgresRuntime,
  provisionSwarmPostgres,
} from "../../../swarm";

import type { DatabaseProvisioner } from "./index";

export const postgresProvisioner: DatabaseProvisioner = {
  engine: "postgres",
  provision: (input, log) => provisionSwarmPostgres(input, log),
  destroy: ({ serviceName }, log) => destroySwarmPostgres({ serviceName }, log),
  inspectRuntime: (input) => inspectSwarmPostgresRuntime(input),
};
