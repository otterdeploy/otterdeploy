import type { RequestLogger } from "evlog";

import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

import {
  destroySwarmDatabase,
  inspectSwarmDatabaseRuntime,
  provisionSwarmDatabase,
} from "../../../swarm";

export interface ProvisionInput {
  serviceName: string;
  volumeName: string;
  hostnameAlias: string;
  databaseName: string;
  username: string;
  password: string;
  projectSlug: string;
  /** Deployment row id — stamped on the swarm spec so tasks group under
   *  the right deployment in the Deployments tab. */
  deploymentId: string;
  /** Optional image override (`<repo>:<tag>`). Defaults to the engine's
   *  pinned image when omitted. */
  image?: string;
  /** User-added envs merged with the engine's identity envs. */
  extraEnv?: Record<string, string>;
  /** When true, publish the engine's port on the swarm node's host
   *  interface. Off by default — in-cluster apps use overlay DNS. */
  public?: boolean;
}

export interface ProvisionRuntime {
  serviceId: string | null;
  serviceName: string;
  volumeName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
}

export interface DatabaseProvisioner {
  readonly engine: DatabaseEngine;
  provision(input: ProvisionInput, log: RequestLogger): Promise<ProvisionRuntime>;
  destroy(input: { serviceName: string }, log: RequestLogger): Promise<void>;
  inspectRuntime(input: {
    serviceName: string;
    volumeName: string;
    projectSlug: string;
  }): Promise<ProvisionRuntime>;
}

// Single generic provisioner — all engines share the same swarm orchestration
// (network ensure, service create, wait-ready, etc.). Engine-specific knobs
// (image, env, healthcheck, mount path, optional --requirepass command) live
// in the adapters under packages/api/src/swarm/database-engines/.
const makeProvisioner = (engine: DatabaseEngine): DatabaseProvisioner => ({
  engine,
  provision: (input, log) =>
    provisionSwarmDatabase({ ...input, engine }, log),
  destroy: ({ serviceName }, log) =>
    destroySwarmDatabase({ serviceName }, log),
  inspectRuntime: (input) => inspectSwarmDatabaseRuntime(input),
});

const PROVISIONERS: Record<DatabaseEngine, DatabaseProvisioner> = {
  postgres: makeProvisioner("postgres"),
  redis: makeProvisioner("redis"),
  mariadb: makeProvisioner("mariadb"),
  mongodb: makeProvisioner("mongodb"),
};

export function getDatabaseProvisioner(engine: DatabaseEngine): DatabaseProvisioner {
  return PROVISIONERS[engine];
}
