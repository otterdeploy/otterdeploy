/**
 * Runtime-backed database functions, drop-in for the old `swarm/*` database
 * exports. Call sites import these instead of the swarm originals so a database
 * provisions through the active runtime (plain Docker by default, Swarm when
 * scaling) without any call-site logic change — only the import path moves.
 * See docs/designs/runtime.md.
 */
import type { RequestLogger } from "evlog";

import { runtime } from "./index";
import type { DatabaseSpec, DatabaseStatus } from "./types";

type DbInspectInput = {
  serviceName: string;
  volumeName: string;
  projectSlug: string;
};
type PostgresInput = Omit<DatabaseSpec, "engine">;

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

export const inspectSwarmDatabaseRuntime = (
  input: DbInspectInput,
): Promise<DatabaseStatus> => runtime().inspectDatabase(input);

// ── Legacy postgres-pinned wrappers ──
const provisionSwarmPostgres = (
  input: PostgresInput,
  log?: RequestLogger,
): Promise<DatabaseStatus> =>
  runtime().provisionDatabase({ ...input, engine: "postgres" }, log);

const updateSwarmPostgres = (
  input: PostgresInput,
  log?: RequestLogger,
): Promise<DatabaseStatus> =>
  runtime().updateDatabase({ ...input, engine: "postgres" }, log);

export const destroySwarmPostgres = (
  input: { serviceName: string },
  log?: RequestLogger,
): Promise<void> => runtime().destroyDatabase(input, log);

const inspectSwarmPostgresRuntime = (
  input: DbInspectInput,
): Promise<DatabaseStatus> => runtime().inspectDatabase(input);
