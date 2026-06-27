/**
 * Runtime-backed database functions, drop-in for the old `swarm/*` database
 * exports. Call sites import these instead of the swarm originals so a database
 * provisions through the active runtime (plain Docker by default, Swarm when
 * scaling) without any call-site logic change — only the import path moves.
 * See docs/designs/runtime.md.
 */
import type { RequestLogger } from "evlog";

import type { DatabaseSpec, DatabaseStatus } from "./types";

import { runtime } from "./index";

interface DbInspectInput {
  serviceName: string;
  volumeName: string;
  projectSlug: string;
}

export const provisionSwarmDatabase = (
  input: DatabaseSpec,
  log?: RequestLogger,
): Promise<DatabaseStatus> => runtime().provisionDatabase(input, log);

export const updateSwarmDatabase = (
  input: DatabaseSpec,
  log?: RequestLogger,
): Promise<DatabaseStatus> => runtime().updateDatabase(input, log);

export const destroySwarmDatabase = (
  input: { serviceName: string },
  log?: RequestLogger,
): Promise<void> => runtime().destroyDatabase(input, log);

export const inspectSwarmDatabaseRuntime = (input: DbInspectInput): Promise<DatabaseStatus> =>
  runtime().inspectDatabase(input);

// ── Legacy postgres-pinned wrapper ──
// provision/update/inspect-postgres live in swarm/postgres.ts (exported via
// swarm/index.ts); only the destroy wrapper is consumed through this shim.
export const destroySwarmPostgres = (
  input: { serviceName: string },
  log?: RequestLogger,
): Promise<void> => runtime().destroyDatabase(input, log);
