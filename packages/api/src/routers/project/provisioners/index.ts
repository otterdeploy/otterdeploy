import type { RequestLogger } from "evlog";

import type { DatabaseEngine } from "@otterstack/shared/database-engines";

export interface ProvisionInput {
  serviceName: string;
  volumeName: string;
  hostnameAlias: string;
  databaseName: string;
  username: string;
  password: string;
  projectSlug: string;
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

import { postgresProvisioner } from "./postgres";

const PROVISIONERS: Record<DatabaseEngine, DatabaseProvisioner> = {
  postgres: postgresProvisioner,
};

export function getDatabaseProvisioner(engine: DatabaseEngine): DatabaseProvisioner {
  return PROVISIONERS[engine];
}
