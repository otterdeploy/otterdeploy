/**
 * Legacy postgres-only swarm wrappers. The real implementation lives in
 * `./database.ts`; this file pins `engine: "postgres"` for callers that
 * haven't migrated to the generic database surface yet.
 *
 * Prefer the generic exports (provisionSwarmDatabase etc.) for new code —
 * those carry the `engine` field and work for redis / mariadb / mongodb
 * without any wrapper changes.
 */

import type { RequestLogger } from "evlog";

import {
  type ProvisionSwarmDatabaseInput,
  type SwarmDatabaseRuntime,
  destroySwarmDatabase,
  inspectSwarmDatabaseRuntime,
  provisionSwarmDatabase,
  updateSwarmDatabase,
} from "./database";

export type SwarmPostgresRuntime = SwarmDatabaseRuntime;

type ProvisionSwarmPostgresInput = Omit<ProvisionSwarmDatabaseInput, "engine">;

export function provisionSwarmPostgres(
  input: ProvisionSwarmPostgresInput,
  rlog?: RequestLogger,
): Promise<SwarmPostgresRuntime> {
  return provisionSwarmDatabase({ ...input, engine: "postgres" }, rlog);
}

export function updateSwarmPostgres(
  input: ProvisionSwarmPostgresInput,
  rlog?: RequestLogger,
): Promise<SwarmPostgresRuntime> {
  return updateSwarmDatabase({ ...input, engine: "postgres" }, rlog);
}

export function inspectSwarmPostgresRuntime(input: {
  serviceName: string;
  volumeName: string;
  projectSlug: string;
}): Promise<SwarmPostgresRuntime> {
  return inspectSwarmDatabaseRuntime(input);
}

export function destroySwarmPostgres(
  input: { serviceName: string },
  rlog?: RequestLogger,
): Promise<void> {
  return destroySwarmDatabase(input, rlog);
}
