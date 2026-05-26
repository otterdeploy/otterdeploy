/**
 * Engine adapter registry. The swarm spec / create flow / connection-string
 * builder all read engine-specific knobs (image, env scheme, healthcheck,
 * mount path, ready-line pattern) from these adapters instead of branching
 * on the engine name in line.
 *
 * Adding a new engine = one new adapter file + one line of registration.
 */

import {
  DATABASE_ENGINES,
  type DatabaseEngine,
} from "@otterstack/shared/database-engines";

export interface ConnectionStringInput {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
  /** Postgres-style SSL controls. Ignored by engines that don't speak it. */
  sslmode?: "require" | "prefer" | "disable";
  sslnegotiation?: "direct";
}

export interface DatabaseEngineAdapter {
  readonly engine: DatabaseEngine;
  /** Default `<repo>:<tag>` for fresh deployments. Honours the catalog's
   *  defaultTag — change the tag in `shared/database-engines.ts` to repin. */
  readonly defaultImage: string;
  /** Port the container listens on inside the swarm overlay network. */
  readonly port: number;
  /** Volume mount target inside the container. */
  readonly mountTarget: string;
  /** Env keys this engine reserves for identity — anything user-set with one
   *  of these names gets filtered out of `extraEnv` so the operator can't
   *  accidentally break the boot by overriding e.g. POSTGRES_PASSWORD. */
  readonly reservedEnvKeys: ReadonlySet<string>;
  /** Build the docker Env array entries for the engine's identity vars
   *  (user / pass / db). Returned as `KEY=value` strings, ready to splice
   *  into ContainerSpec.Env after the user's extraEnv. */
  buildEnv(input: {
    username: string;
    password: string;
    databaseName: string;
  }): string[];
  /** Optional ContainerSpec.Command override. Used by engines that pass
   *  auth via command-line flags rather than env (e.g. redis-server
   *  --requirepass). Undefined means "use the image's CMD". */
  buildCommand?(input: { password: string }): string[] | undefined;
  /** Docker healthcheck command — exec'd as a single shell string via
   *  CMD-SHELL. Must exit 0 when the engine is ready to serve queries. */
  buildHealthcheck(input: {
    username: string;
    password: string;
    databaseName: string;
  }): string;
  /** Build a client connection string for display + DATABASE_URL. */
  buildConnectionString(input: ConnectionStringInput): string;
  /** Regex matched against container stdout/stderr during the boot-log
   *  tail. When this matches, the create stream exits the boot tail and
   *  reports success. */
  readonly readyPattern: RegExp;
}

import { postgresAdapter } from "./postgres";
import { redisAdapter } from "./redis";
import { mariadbAdapter } from "./mariadb";
import { mongodbAdapter } from "./mongodb";

const ADAPTERS: Record<DatabaseEngine, DatabaseEngineAdapter> = {
  postgres: postgresAdapter,
  redis: redisAdapter,
  mariadb: mariadbAdapter,
  mongodb: mongodbAdapter,
};

export function getEngineAdapter(engine: DatabaseEngine): DatabaseEngineAdapter {
  return ADAPTERS[engine];
}

/** Resolve the catalog default image for an engine. Useful for create flows
 *  that haven't yet plumbed an explicit version through the request. */
export function defaultImageFor(engine: DatabaseEngine): string {
  return ADAPTERS[engine].defaultImage;
}

/** Re-export catalog metadata for callers that want both engine config
 *  (this adapter) and presentation metadata (label/category) in one go. */
export function catalogFor(engine: DatabaseEngine) {
  return DATABASE_ENGINES[engine];
}
